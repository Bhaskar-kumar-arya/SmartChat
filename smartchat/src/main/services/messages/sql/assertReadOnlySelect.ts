/**
 * Single shared read-only SQL guard (R-AI-04).
 *
 * Replaces three hand-copied denylists (QueryDatabaseTool, ReadMessagesTool,
 * MessageQueryRepository). The scan itself (strip literals/comments, require a
 * leading SELECT/WITH, reject denylisted keywords) is shared; the *policy*
 * (which keywords, whether batching is rejected) and the error wording are
 * per-caller because the callers historically disagree. Those differences are
 * pinned by `tests/sql/readOnlyGuard.characterization.test.ts` and are tracked
 * as a follow-up, not changed here.
 */

export interface ReadOnlySqlPolicy {
  /** Whole-word, case-insensitive keywords rejected anywhere in the code portion. */
  readonly forbiddenKeywords: readonly string[];
  /** Extra mutating forms the bare keyword scan does not catch. */
  readonly forbiddenPatterns: ReadonlyArray<{ re: RegExp; label: string }>;
  /** Reject `a; b` (a single trailing `;` is fine). */
  readonly rejectMultipleStatements: boolean;
}

const BASE_KEYWORDS = [
  'INSERT', 'UPDATE', 'DELETE', 'DROP', 'ALTER',
  'CREATE', 'ATTACH', 'DETACH', 'PRAGMA', 'VACUUM',
  'TRUNCATE', 'GRANT', 'REVOKE'
] as const;

/**
 * AI tools (queryDatabase / readMessages). `REPLACE` is intentionally not a
 * keyword: `REPLACE(x,y,z)` is a read-only scalar; only the `REPLACE INTO` /
 * `INSERT OR REPLACE` mutating forms are rejected. Also rejects side-effecting
 * filesystem SQLite functions a pure SELECT could still call.
 */
export const TOOL_READ_ONLY_POLICY: ReadOnlySqlPolicy = {
  forbiddenKeywords: [...BASE_KEYWORDS, 'LOAD_EXTENSION', 'READFILE', 'WRITEFILE', 'FSDIR'],
  forbiddenPatterns: [
    { re: /\bREPLACE\s+INTO\b/, label: 'REPLACE INTO' },
    { re: /\bINSERT\s+OR\s+REPLACE\b/, label: 'INSERT OR REPLACE' }
  ],
  rejectMultipleStatements: false
};

/** MessageQueryRepository.queryMessageIdsBySql (the last line of defence before Prisma). */
export const REPOSITORY_READ_ONLY_POLICY: ReadOnlySqlPolicy = {
  forbiddenKeywords: [...BASE_KEYWORDS, 'REPLACE', 'REINDEX'],
  forbiddenPatterns: [],
  rejectMultipleStatements: true
};

export type ReadOnlyViolation =
  | { kind: 'not-select'; original: string }
  | { kind: 'multiple-statements' }
  | { kind: 'keyword'; keyword: string }
  | { kind: 'pattern'; label: string };

/**
 * Remove SQL string literals ('...', "..."), and `--` / block comments so the
 * scan only sees SQL *code*, not user data (`LIKE '%please update me%'`).
 */
export function stripLiteralsAndComments(sql: string): string {
  return sql
    .replace(/'(?:[^']|'')*'/g, "''")
    .replace(/"(?:[^"]|"")*"/g, '""')
    .replace(/--[^\n]*/g, ' ')
    .replace(/\/\*[\s\S]*?\*\//g, ' ');
}

/** Returns the first policy violation, or null when the statement is accepted. */
export function findReadOnlyViolation(sql: string, policy: ReadOnlySqlPolicy): ReadOnlyViolation | null {
  const trimmed = (sql ?? '').trim();
  const normalized = stripLiteralsAndComments(trimmed).toUpperCase().replace(/\s+/g, ' ').trim();

  if (!normalized.startsWith('SELECT') && !normalized.startsWith('WITH')) {
    return { kind: 'not-select', original: trimmed };
  }

  if (policy.rejectMultipleStatements && normalized.slice(0, -1).includes(';')) {
    return { kind: 'multiple-statements' };
  }

  for (const keyword of policy.forbiddenKeywords) {
    if (new RegExp(`\\b${keyword}\\b`).test(normalized)) return { kind: 'keyword', keyword };
  }

  for (const { re, label } of policy.forbiddenPatterns) {
    if (re.test(normalized)) return { kind: 'pattern', label };
  }

  return null;
}

/**
 * Throws unless `sql` is a read-only SELECT / WITH…SELECT under `policy`.
 * `prefix` (e.g. `'[ReadMessagesTool] '`) is prepended to the tool-style messages.
 */
export function assertReadOnlySelect(sql: string, policy: ReadOnlySqlPolicy, prefix = ''): void {
  const v = findReadOnlyViolation(sql, policy);
  if (!v) return;
  switch (v.kind) {
    case 'not-select':
      throw new Error(
        `${prefix}Query rejected: Only SELECT or WITH...SELECT statements are allowed. Got: "${v.original.slice(0, 40)}..."`
      );
    case 'keyword':
      throw new Error(
        `${prefix}Query rejected: Forbidden keyword detected — "${v.keyword}". Only read operations are permitted.`
      );
    case 'pattern':
      throw new Error(
        `${prefix}Query rejected: Forbidden statement detected — "${v.label}". Only read operations are permitted.`
      );
    case 'multiple-statements':
      throw new Error(`${prefix}Query rejected: multiple statements are not permitted`);
  }
}

/** Repository-style wording (lower-case, no "Got:" echo). */
export function assertReadOnlySelectForRepository(sql: string, prefix: string): void {
  const v = findReadOnlyViolation(sql, REPOSITORY_READ_ONLY_POLICY);
  if (!v) return;
  switch (v.kind) {
    case 'not-select':
      throw new Error(`${prefix}Query rejected: only SELECT / WITH…SELECT statements are permitted`);
    case 'multiple-statements':
      throw new Error(`${prefix}Query rejected: multiple statements are not permitted`);
    case 'keyword':
      throw new Error(`${prefix}Query rejected: forbidden keyword "${v.keyword}"`);
    case 'pattern':
      throw new Error(`${prefix}Query rejected: forbidden statement "${v.label}"`);
  }
}
