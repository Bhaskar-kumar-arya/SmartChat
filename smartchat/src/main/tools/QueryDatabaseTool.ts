import fs from 'fs';
import path from 'path';
import { AITool } from '../services/ai/IToolRegistry';
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

interface ParserState {
  pendingDoc: string | undefined;
  currentModel: string | undefined;
  result: Record<string, SchemaDescriptions>;
}

function findSchemaPath(): string | undefined {
  const candidates = [
    path.resolve(__dirname, '../../../prisma/schema.prisma'),  // dev: src/main/tools → root
    path.resolve(__dirname, '../../prisma/schema.prisma'),
    path.resolve(__dirname, '../prisma/schema.prisma'),
    path.resolve(process.cwd(), 'prisma/schema.prisma'),
  ];
  return candidates.find(p => fs.existsSync(p));
}

function processSchemaLine(line: string, state: ParserState): void {
  // Accumulate /// doc comment
  if (line.startsWith('///')) {
    const doc = line.replace(/^\/\/\/\s*/, '').trim();
    state.pendingDoc = state.pendingDoc ? `${state.pendingDoc}\n${doc}` : doc;
    return;
  }

  // model Foo {
  const modelMatch = line.match(/^model\s+(\w+)\s*\{/);
  if (modelMatch) {
    state.currentModel = modelMatch[1];
    state.result[state.currentModel] ??= { columns: {} };
    if (state.pendingDoc) state.result[state.currentModel].description = state.pendingDoc;
    state.pendingDoc = undefined;
    return;
  }

  // Closing brace — leave model scope
  if (line === '}') {
    state.currentModel = undefined;
    state.pendingDoc = undefined;
    return;
  }

  // Field line inside a model (e.g. `jid String @id`)
  if (state.currentModel && state.pendingDoc) {
    // Field names are plain identifiers; skip Prisma directives (@@id, @@index …)
    const fieldMatch = line.match(/^([a-zA-Z_]\w*)\s/);
    if (fieldMatch) {
      state.result[state.currentModel].columns[fieldMatch[1]] = state.pendingDoc;
    }
  }

  // Any non-doc, non-empty line clears the pending comment
  if (line && !line.startsWith('//')) state.pendingDoc = undefined;
}

function parsePrismaDocComments(): Record<string, SchemaDescriptions> {
  const schemaPath = findSchemaPath();
  if (!schemaPath) {
    console.warn('[QueryDatabaseTool] Could not locate schema.prisma — descriptions will be omitted.');
    return {};
  }

  const lines = fs.readFileSync(schemaPath, 'utf-8').split('\n');
  const state: ParserState = {
    pendingDoc: undefined,
    currentModel: undefined,
    result: {}
  };

  for (const raw of lines) {
    processSchemaLine(raw.trim(), state);
  }

  console.log(
    `[QueryDatabaseTool] Parsed /// docs from schema.prisma: ${Object.keys(state.result).length} models.`
  );
  return state.result;
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

TIP:
- If structured JSON objects (with repeated keys) are not desired, you can format the output using column concatenation '||' or 'json_array'.

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
    "sql": "WITH LastMsg AS (SELECT chatJid, MAX(timestamp) as last_ts FROM Message GROUP BY chatJid) SELECT c.type as chatType, COALESCE(c.name, i.displayName, i.pushName, i.verifiedName, i.phoneNumber) as chatName, m.messageType, m.textContent, json_extract(m.content, '$.documentMessage.fileName') as fileName, m.timestamp, c.jid, c.unreadCount FROM LastMsg lm JOIN Message m ON lm.chatJid = m.chatJid AND lm.last_ts = m.timestamp JOIN Chat c ON m.chatJid = c.jid LEFT JOIN Identity i ON m.senderId = i.id WHERE m.fromMe = 0 ORDER BY m.timestamp DESC",
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

  private async introspectTable(
    tableName: string,
    prismaDoc: Record<string, SchemaDescriptions>
  ): Promise<string> {
    const columns = await prisma.$queryRawUnsafe<ColumnInfo[]>(
      `PRAGMA table_info(${JSON.stringify(tableName)})`
    );

    // Look up parsed /// docs for this model (Prisma model names match table names)
    const modelDoc = prismaDoc[tableName];
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
      ? `  ${tableName}  -- ${modelDoc.description}`
      : `  ${tableName}`;

    return `${tableHeader}\n    (${colDefs.join(',\n     ')})`;
  }

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

    const tableLines: string[] = [];
    for (const { name } of tables) {
      if (EXCLUDED_TABLE_PREFIXES.some(prefix => name.toLowerCase().startsWith(prefix))) continue;
      const tableBlock = await this.introspectTable(name, prismaDoc);
      tableLines.push(tableBlock);
    }

    return `DATABASE SCHEMA (live, auto-introspected from schema.prisma):\n${tableLines.join('\n')}`;
  }

  private validateSqlQuery(sql: string): void {
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
  }

  private serializeBigInts(rows: unknown[]): Record<string, unknown>[] {
    return rows.map(row => {
      const out: Record<string, unknown> = {};
      if (row && typeof row === 'object') {
        for (const [key, val] of Object.entries(row as Record<string, unknown>)) {
          out[key] = typeof val === 'bigint' ? val.toString() : val;
        }
      }
      return out;
    });
  }

  // ── Execution ─────────────────────────────────────────────────────────────────

  async execute(args: unknown): Promise<unknown> {
    if (!args || typeof args !== 'object') {
      throw new Error('Invalid arguments passed to QueryDatabaseTool');
    }
    const record = args as Record<string, unknown>;
    const sql = record.sql;
    const explanation = record.explanation;
    const params = record.params;

    if (!sql || typeof sql !== 'string') {
      throw new Error('Missing required argument: sql');
    }

    // ── Safety Gate ──────────────────────────────────────────────────────────
    this.validateSqlQuery(sql);

    // ── Enforce row cap ───────────────────────────────────────────────────────
    const trimmed = sql.trim();
    const hasLimit = /\bLIMIT\b/i.test(trimmed);
    let finalSql = trimmed.replace(/;?\s*$/, '');

    if (!hasLimit) {
      finalSql += ` LIMIT ${MAX_ROWS}`;
    } else {
      finalSql = `SELECT * FROM (${finalSql}) AS _capped LIMIT ${MAX_ROWS}`;
    }

    // ── Execute ───────────────────────────────────────────────────────────────
    let rows: unknown[];
    try {
      rows = await prisma.$queryRawUnsafe<unknown[]>(finalSql, ...(Array.isArray(params) ? params : []));
    } catch (err: unknown) {
      const errMsg = err instanceof Error ? err.message : String(err);
      throw new Error(`SQL execution failed: ${errMsg}`);
    }

    const serialized = this.serializeBigInts(rows);
    const explanationStr = typeof explanation === 'string' ? explanation : 'No explanation provided.';

    return {
      explanation: explanationStr,
      rowCount: serialized.length,
      cappedAt: MAX_ROWS,
      rows: serialized
    };
  }
}
