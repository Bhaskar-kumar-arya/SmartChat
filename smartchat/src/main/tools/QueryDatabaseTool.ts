import { AITool } from '../services/AIToolService';
import { prisma } from '../auth';

// Keywords that are never allowed anywhere in the query
const FORBIDDEN_KEYWORDS = [
  'INSERT', 'UPDATE', 'DELETE', 'DROP', 'ALTER',
  'CREATE', 'ATTACH', 'DETACH', 'PRAGMA', 'VACUUM',
  'REPLACE', 'TRUNCATE', 'GRANT', 'REVOKE'
];

// Hard cap on returned rows to prevent memory issues
const MAX_ROWS = 500;

// Tables managed by Prisma/sqlite-vec internals — excluded from schema introspection
const EXCLUDED_TABLE_PREFIXES = ['_prisma', 'sqlite_', 'vec_'];

interface ColumnInfo {
  name: string;
  type: string;
  notnull: number;
  pk: number;
}

const BASE_DESCRIPTION = `Execute a read-only SQL SELECT query directly against the local SQLite database.

WHEN TO USE THIS TOOL:
- User asks for counts, statistics, or aggregations (e.g. "how many messages have I sent?", "which chat is most active?")
- User asks for lists or filtered data (e.g. "show me all chats with unread messages", "who reacted to my messages most?")
- User asks a data question that cannot be answered from conversation context alone
- Any query that requires joining tables, grouping, or ordering data
Prefer this tool over guessing. If the answer lives in the database, query it.

KEY RULES:
- Only SELECT (or WITH...SELECT) statements are permitted.
- Timestamps are stored as Unix epoch in SECONDS (not milliseconds).
- To filter by date use: strftime('%s', 'YYYY-MM-DD') to convert a date string to a unix timestamp.
- 'fromMe = 1' means the logged-in user sent the message.
- SCHEMA CONTEXT - Message table: 'senderId' maps to the Identity table. 'participant' is the raw JID string. 'chatJid' is the chat/group ID.
- SCHEMA CONTEXT - Identity table: 'displayName' is the local name the user explicitly saved in their contacts(null if not saved). 'pushName' is the public name chosen by the person themselves on WhatsApp. 'phoneNumber' may be null if hidden by group privacy (PNP).
- SCHEMA CONTEXT - Group Members: Join ChatMember with Identity. To get their raw LIDs/JIDs, join with IdentityAlias.
- Always provide a plain-English 'explanation' field — it is shown to the user before execution.
- Results are capped at ${MAX_ROWS} rows automatically.`;

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
        description: 'A valid SQLite SELECT (or WITH...SELECT) statement. No mutations allowed.'
      },
      explanation: {
        type: 'string',
        description: 'A plain-English one-line summary of what this query does. Shown to the user before execution.'
      }
    },
    required: ['sql', 'explanation']
  };

  // ── Lifecycle: called once by AIToolInitializer after registration ────────────

  async initialize(): Promise<void> {
    const schemaBlock = await this.introspectSchema();
    this.description = `${BASE_DESCRIPTION}\n\n${schemaBlock}`;
    console.log('[QueryDatabaseTool] Schema introspected and description updated.');
  }

  // ── Schema Introspection ───────────────────────────────────────────────────────

  private async introspectSchema(): Promise<string> {
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

    // 2. For each table, fetch column info via PRAGMA
    const tableLines: string[] = [];

    for (const { name } of tables) {
      // Skip any remaining internal tables
      if (EXCLUDED_TABLE_PREFIXES.some(prefix => name.toLowerCase().startsWith(prefix))) continue;

      const columns = await prisma.$queryRawUnsafe<ColumnInfo[]>(
        `PRAGMA table_info(${JSON.stringify(name)})`
      );

      const colDefs = columns.map(col => {
        const parts = [col.name, col.type.toUpperCase() || 'TEXT'];
        if (col.pk) parts.push('PK');
        if (col.notnull && !col.pk) parts.push('NOT NULL');
        return parts.join(' ');
      });

      tableLines.push(`  ${name}(${colDefs.join(', ')})`);
    }

    return `DATABASE SCHEMA (live, auto-introspected):\n${tableLines.join('\n')}`;
  }

  // ── Execution ─────────────────────────────────────────────────────────────────

  async execute(args: any): Promise<any> {
    const { sql, explanation } = args;

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
      rows = await prisma.$queryRawUnsafe<any[]>(finalSql);
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
