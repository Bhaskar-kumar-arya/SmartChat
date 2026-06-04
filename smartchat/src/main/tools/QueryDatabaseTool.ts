import fs from 'fs';
import path from 'path';
import { AITool } from '../services/ai/AIToolService';
import { prisma } from '../auth';

// Keywords that are never allowed anywhere in the query
const FORBIDDEN_KEYWORDS = [
  'INSERT', 'UPDATE', 'DELETE', 'DROP', 'ALTER',
  'CREATE', 'ATTACH', 'DETACH', 'PRAGMA', 'VACUUM',
  'REPLACE', 'TRUNCATE', 'GRANT', 'REVOKE'
];

// Hard cap on returned rows to prevent memory issues
const MAX_ROWS = 1500;

// Tables managed by Prisma/sqlite-vec internals — excluded from schema introspection
const EXCLUDED_TABLE_PREFIXES = ['_prisma', 'sqlite_', 'vec_'];

interface ColumnInfo {
  name: string;
  type: string;
  notnull: number;
  pk: number;
}

// ── schema.prisma /// doc-comment parser ──────────────────────────────────────
// Reads descriptions directly from `///` triple-slash comments in schema.prisma.
// To document a table or column, just add a `///` line above it there.
// Nothing here needs to change when you modify the schema.

interface SchemaDescriptions {
  description?: string;
  columns: Record<string, string>;
}

function parsePrismaDocComments(): Record<string, SchemaDescriptions> {
  // Walk up from __dirname to find prisma/schema.prisma (works in dev & prod)
  const candidates = [
    path.resolve(__dirname, '../../../prisma/schema.prisma'),  // dev: src/main/tools → root
    path.resolve(__dirname, '../../prisma/schema.prisma'),
    path.resolve(__dirname, '../prisma/schema.prisma'),
    path.resolve(process.cwd(), 'prisma/schema.prisma'),
  ];

  const schemaPath = candidates.find(p => fs.existsSync(p));
  if (!schemaPath) {
    console.warn('[QueryDatabaseTool] Could not locate schema.prisma — descriptions will be omitted.');
    return {};
  }

  const lines = fs.readFileSync(schemaPath, 'utf-8').split('\n');
  const result: Record<string, SchemaDescriptions> = {};

  let pendingDoc: string | undefined;
  let currentModel: string | undefined;

  for (const raw of lines) {
    const line = raw.trim();

    // Accumulate /// doc comment
    if (line.startsWith('///')) {
      const doc = line.replace(/^\/\/\/\s*/, '').trim();
      pendingDoc = pendingDoc ? `${pendingDoc}\n${doc}` : doc;
      continue;
    }

    // model Foo {
    const modelMatch = line.match(/^model\s+(\w+)\s*\{/);
    if (modelMatch) {
      currentModel = modelMatch[1];
      result[currentModel] ??= { columns: {} };
      if (pendingDoc) result[currentModel].description = pendingDoc;
      pendingDoc = undefined;
      continue;
    }

    // Closing brace — leave model scope
    if (line === '}') {
      currentModel = undefined;
      pendingDoc = undefined;
      continue;
    }

    // Field line inside a model (e.g. `jid String @id`)
    if (currentModel && pendingDoc) {
      // Field names are plain identifiers; skip Prisma directives (@@id, @@index …)
      const fieldMatch = line.match(/^([a-zA-Z_]\w*)\s/);
      if (fieldMatch) {
        result[currentModel].columns[fieldMatch[1]] = pendingDoc;
      }
    }

    // Any non-doc, non-empty line clears the pending comment
    if (line && !line.startsWith('//')) pendingDoc = undefined;
  }

  console.log(
    `[QueryDatabaseTool] Parsed /// docs from schema.prisma: ${Object.keys(result).length} models.`
  );
  return result;
}

const BASE_DESCRIPTION = `Execute a read-only SQL SELECT query against the local SQLite database.

CAN BE USED FOR:
- Data retrieval, filtering, and aggregation
- Fetching factual information not present in the current context
- Verifying assumptions against the source data

HOW TO USE:
- Only SELECT (or WITH...SELECT) statements are permitted
- Schema relationships and column descriptions are documented in the DATABASE SCHEMA section below — always refer to it before writing a query
- Always provide a plain-English 'explanation' field — it is shown to the user before execution

WHAT YOU RECEIVE BACK:
{
  "rowCount": N,
  "cappedAt": ${MAX_ROWS},
  "rows": [{ "column": "value", ... }]
}
Note: Timestamp columns may be returned as strings due to BigInt serialization.

CONSTRAINTS:
- Results are capped at ${MAX_ROWS} rows automatically
- Read-only — INSERT, UPDATE, DELETE, DROP and similar mutations are rejected

EXAMPLES(YOU MUST ADHERE TO THESE PATTERNS):
User: "find chats i haven't replied to"

<thought>
The user wants to find chats where the last message was received (fromMe = 0). I will write a query that finds the latest message for each chat, joins with Chat and Identity to get the names, and retrieves the message details. To avoid pulling massive base64 thumbnails, I will use json_extract for the filename.
</thought>
<tool_call>
{
  "tool": "queryDatabase",
  "arguments": {
    "sql": "WITH LastMsg AS (SELECT chatJid, MAX(timestamp) as last_ts FROM Message GROUP BY chatJid) SELECT c.name as groupName, i.displayName as contactName, m.messageType, m.textContent, json_extract(m.content, '$.documentMessage.fileName') as fileName, m.timestamp, c.jid FROM LastMsg lm JOIN Message m ON lm.chatJid = m.chatJid AND lm.last_ts = m.timestamp JOIN Chat c ON m.chatJid = c.jid LEFT JOIN Identity i ON m.senderId = i.id WHERE m.fromMe = 0 ORDER BY m.timestamp DESC",
    "explanation": "Finding all chats where the last message was received, including message details and sender identities."
  }
}
</tool_call>`;


export class QueryDatabaseTool implements AITool {
  name = 'queryDatabase';
  requiresPermission = true;

  // Starts with base description; schema section is appended after initialize() runs
  description: string = BASE_DESCRIPTION + '\n\nDATABASE SCHEMA: (loading...)';

  parametersSchema = {
    type: 'object',
    properties: {
      sql: {
        type: 'string',
        description: 'A valid SQLite SELECT (or WITH...SELECT) statement. Use ? placeholders for parameterized values.'
      },
      explanation: {
        type: 'string',
        description: 'A plain-English one-line summary of what this query does. Shown to the user before execution.'
      },
      params: {
        type: 'array',
        items: {},
        description: 'Optional array of values to substitute into ? placeholders in the SQL string, in order.'
      }
    },
    required: ['sql', 'explanation']
  };

  // ── Lifecycle: called once by AIToolInitializer after registration ────────────

  async initialize(): Promise<void> {
    // Parse /// doc comments from schema.prisma first, then merge with live PRAGMA data
    const prismaDoc = parsePrismaDocComments();
    const schemaBlock = await this.introspectSchema(prismaDoc);
    this.description = `${BASE_DESCRIPTION}\n\n${schemaBlock}`;
    console.log('[QueryDatabaseTool] Schema introspected and description updated.');
  }

  // ── Schema Introspection ───────────────────────────────────────────────────────

  private async introspectSchema(prismaDoc: Record<string, SchemaDescriptions>): Promise<string> {
    // 1. Fetch all user-facing tables from sqlite_master
    const tables = await prisma.$queryRawUnsafe<{ name: string }[]>(
      `SELECT name FROM sqlite_master
       WHERE type = 'table'
         AND name NOT LIKE 'sqlite_%'
         AND name NOT LIKE '\\_prisma%' ESCAPE '\\'
         AND name NOT LIKE 'vec\\_%' ESCAPE '\\'
       ORDER BY name`
    );

    if (tables.length === 0) return 'DATABASE SCHEMA: (no tables found)';

    // 2. For each table, fetch column info via PRAGMA and merge /// docs
    const tableLines: string[] = [];

    for (const { name } of tables) {
      if (EXCLUDED_TABLE_PREFIXES.some(prefix => name.toLowerCase().startsWith(prefix))) continue;

      const columns = await prisma.$queryRawUnsafe<ColumnInfo[]>(
        `PRAGMA table_info(${JSON.stringify(name)})`
      );

      // Look up parsed /// docs for this model (Prisma model names match table names)
      const modelDoc = prismaDoc[name];
      const colDocs  = modelDoc?.columns ?? {};

      const colDefs = columns.map(col => {
        const parts = [col.name, col.type.toUpperCase() || 'TEXT'];
        if (col.pk) parts.push('PK');
        if (col.notnull && !col.pk) parts.push('NOT NULL');
        const desc = colDocs[col.name];
        if (desc) parts.push(`-- ${desc}`);
        return parts.join(' ');
      });

      const tableHeader = modelDoc?.description
        ? `  ${name}  -- ${modelDoc.description}`
        : `  ${name}`;

      tableLines.push(`${tableHeader}\n    (${colDefs.join(',\n     ')})`);
    }

    return `DATABASE SCHEMA (live, auto-introspected from schema.prisma):\n${tableLines.join('\n')}`;
  }

  // ── Execution ─────────────────────────────────────────────────────────────────

  async execute(args: any): Promise<any> {
    const { sql, explanation, params } = args;

    if (!sql || typeof sql !== 'string') {
      throw new Error('Missing required argument: sql');
    }

    // ── Safety Gate ──────────────────────────────────────────────────────────
    const trimmed = sql.trim();
    const normalized = trimmed.toUpperCase().replace(/\s+/g, ' ');

    if (!normalized.startsWith('SELECT') && !normalized.startsWith('WITH')) {
      throw new Error(
        `Query rejected: Only SELECT or WITH...SELECT statements are allowed. Got: "${trimmed.slice(0, 40)}..."`
      );
    }

    for (const kw of FORBIDDEN_KEYWORDS) {
      const wordBoundaryRegex = new RegExp(`\\b${kw}\\b`);
      if (wordBoundaryRegex.test(normalized)) {
        throw new Error(
          `Query rejected: Forbidden keyword detected — "${kw}". Only read operations are permitted.`
        );
      }
    }

    // ── Enforce row cap ───────────────────────────────────────────────────────
    const hasLimit = /\bLIMIT\b/i.test(trimmed);
    let finalSql = trimmed.replace(/;?\s*$/, '');

    if (!hasLimit) {
      finalSql += ` LIMIT ${MAX_ROWS}`;
    } else {
      finalSql = `SELECT * FROM (${finalSql}) AS _capped LIMIT ${MAX_ROWS}`;
    }

    // ── Execute ───────────────────────────────────────────────────────────────
    let rows: any[];
    try {
      rows = await prisma.$queryRawUnsafe<any[]>(finalSql, ...(Array.isArray(params) ? params : []));
    } catch (err: any) {
      throw new Error(`SQL execution failed: ${err?.message || String(err)}`);
    }

    // Serialize BigInt timestamps to strings for safe JSON transport
    const serialized = rows.map(row => {
      const out: Record<string, any> = {};
      for (const [key, val] of Object.entries(row)) {
        out[key] = typeof val === 'bigint' ? val.toString() : val;
      }
      return out;
    });

    return {
      explanation: explanation || 'No explanation provided.',
      rowCount: serialized.length,
      cappedAt: MAX_ROWS,
      rows: serialized
    };
  }
}
