import { describe, it, expect, vi } from 'vitest'

vi.mock('../../auth', () => ({ prisma: { $queryRawUnsafe: vi.fn() } }))

import { QueryDatabaseTool } from '../../tools/QueryDatabaseTool'
import { ReadMessagesTool } from '../../tools/ReadMessagesTool'
import { MessageQueryRepository } from '../../services/messages/MessageQueryRepository'

/**
 * R-AI-04 characterization: pins the accept/reject behaviour of each of the
 * three read-only SQL guards (QueryDatabaseTool, ReadMessagesTool,
 * MessageQueryRepository). The guards DISAGREE on a few statements; both sides
 * are pinned so the shared-guard extraction cannot silently change either.
 * ExecuteScriptTool has no SQL guard of its own: it calls queryDatabase /
 * readMessages, which apply the guards below.
 */

type Verdict = 'ok' | RegExp

const queryDb = (sql: string): void =>
  (new QueryDatabaseTool() as unknown as { validateSqlQuery(s: string): void }).validateSqlQuery(sql)

const readMessagesTool = new ReadMessagesTool(
  () => null,
  {} as never,
  {} as never,
  {} as never,
  {} as never,
  {} as never
)
const readMsgs = (sql: string): void =>
  (readMessagesTool as unknown as { validateSqlQuery(s: string): void }).validateSqlQuery(sql)

const repo = (sql: string): void => MessageQueryRepository.assertReadOnlySql(sql)

function check(guard: (s: string) => void, sql: string, verdict: Verdict): void {
  if (verdict === 'ok') expect(() => guard(sql)).not.toThrow()
  else expect(() => guard(sql)).toThrow(verdict)
}

interface Case { name: string; sql: string; qdt: Verdict; rmt: Verdict; repo: Verdict }

const NOT_SELECT_TOOL = /Only SELECT or WITH\.\.\.SELECT/
const NOT_SELECT_REPO = /only SELECT \/ WITH…SELECT/
const kw = (k: string): RegExp => new RegExp(`Forbidden keyword detected — "${k}"`)
const repoKw = (k: string): RegExp => new RegExp(`forbidden keyword "${k}"`)

const CASES: Case[] = [
  // ── agreement: plain accepts ──
  { name: 'simple select', sql: 'SELECT id FROM Message', qdt: 'ok', rmt: 'ok', repo: 'ok' },
  { name: 'lowercase select', sql: 'select id from Message', qdt: 'ok', rmt: 'ok', repo: 'ok' },
  { name: 'leading whitespace/newlines', sql: '  \n\t SELECT 1', qdt: 'ok', rmt: 'ok', repo: 'ok' },
  { name: 'WITH CTE select', sql: 'WITH a AS (SELECT 1 AS x) SELECT x FROM a', qdt: 'ok', rmt: 'ok', repo: 'ok' },
  { name: 'lowercase with', sql: 'with a as (select 1) select * from a', qdt: 'ok', rmt: 'ok', repo: 'ok' },
  { name: 'single trailing semicolon', sql: 'SELECT 1;', qdt: 'ok', rmt: 'ok', repo: 'ok' },
  { name: 'trailing semicolon + whitespace', sql: 'SELECT 1;  \n', qdt: 'ok', rmt: 'ok', repo: 'ok' },
  { name: 'keyword inside single-quoted literal', sql: "SELECT id FROM Message WHERE textContent LIKE '%delete me%'", qdt: 'ok', rmt: 'ok', repo: 'ok' },
  { name: 'keyword inside double-quoted identifier', sql: 'SELECT "update" FROM Message', qdt: 'ok', rmt: 'ok', repo: 'ok' },
  { name: 'escaped quote inside literal', sql: "SELECT id FROM Message WHERE textContent = 'it''s a DROP'", qdt: 'ok', rmt: 'ok', repo: 'ok' },
  { name: 'keyword in line comment', sql: "SELECT id FROM Message -- DROP TABLE Message\n WHERE id = '1'", qdt: 'ok', rmt: 'ok', repo: 'ok' },
  { name: 'keyword in block comment', sql: 'SELECT /* DELETE FROM x */ 1', qdt: 'ok', rmt: 'ok', repo: 'ok' },
  { name: 'leading comment before select', sql: '-- hi\nSELECT 1', qdt: 'ok', rmt: 'ok', repo: 'ok' },
  { name: 'keyword as identifier substring', sql: 'SELECT updated_at, created FROM Message', qdt: 'ok', rmt: 'ok', repo: 'ok' },
  { name: 'semicolon inside literal', sql: "SELECT 'a;b'", qdt: 'ok', rmt: 'ok', repo: 'ok' },
  { name: 'semicolon inside comment', sql: 'SELECT 1 -- ; x', qdt: 'ok', rmt: 'ok', repo: 'ok' },

  // ── agreement: rejects ──
  { name: 'DELETE', sql: 'DELETE FROM Message', qdt: NOT_SELECT_TOOL, rmt: NOT_SELECT_TOOL, repo: NOT_SELECT_REPO },
  { name: 'UPDATE', sql: "UPDATE Message SET textContent = 'x'", qdt: NOT_SELECT_TOOL, rmt: NOT_SELECT_TOOL, repo: NOT_SELECT_REPO },
  { name: 'empty string', sql: '', qdt: NOT_SELECT_TOOL, rmt: NOT_SELECT_TOOL, repo: NOT_SELECT_REPO },
  { name: 'whitespace only', sql: '   ', qdt: NOT_SELECT_TOOL, rmt: NOT_SELECT_TOOL, repo: NOT_SELECT_REPO },
  { name: 'comment only', sql: '-- SELECT 1', qdt: NOT_SELECT_TOOL, rmt: NOT_SELECT_TOOL, repo: NOT_SELECT_REPO },
  { name: 'PRAGMA statement', sql: 'PRAGMA table_info(Message)', qdt: NOT_SELECT_TOOL, rmt: NOT_SELECT_TOOL, repo: NOT_SELECT_REPO },
  { name: 'EXPLAIN select', sql: 'EXPLAIN SELECT 1', qdt: NOT_SELECT_TOOL, rmt: NOT_SELECT_TOOL, repo: NOT_SELECT_REPO },
  { name: 'select then DROP (multi-statement)', sql: 'SELECT id FROM Message; DROP TABLE Message', qdt: kw('DROP'), rmt: kw('DROP'), repo: /multiple statements/ },
  { name: 'select then DELETE', sql: 'SELECT 1; DELETE FROM Message', qdt: kw('DELETE'), rmt: kw('DELETE'), repo: /multiple statements/ },
  { name: 'select then INSERT OR REPLACE', sql: 'SELECT 1; INSERT OR REPLACE INTO Message VALUES (1)', qdt: kw('INSERT'), rmt: kw('INSERT'), repo: /multiple statements/ },
  { name: 'CTE with DELETE', sql: 'WITH a AS (SELECT 1) DELETE FROM Message WHERE id IN (SELECT * FROM a)', qdt: kw('DELETE'), rmt: kw('DELETE'), repo: repoKw('DELETE') },
  { name: 'CTE with INSERT', sql: 'WITH a AS (SELECT 1) INSERT INTO Message SELECT * FROM a', qdt: kw('INSERT'), rmt: kw('INSERT'), repo: repoKw('INSERT') },
  { name: 'CTE with UPDATE', sql: 'WITH a AS (SELECT 1) UPDATE Message SET fromMe = 1', qdt: kw('UPDATE'), rmt: kw('UPDATE'), repo: repoKw('UPDATE') },
  { name: 'ATTACH inside select', sql: 'SELECT 1 FROM x WHERE ATTACH = 1', qdt: kw('ATTACH'), rmt: kw('ATTACH'), repo: repoKw('ATTACH') },
  { name: 'DETACH', sql: 'WITH a AS (SELECT 1) DETACH x', qdt: kw('DETACH'), rmt: kw('DETACH'), repo: repoKw('DETACH') },
  { name: 'PRAGMA after select (multi-statement)', sql: 'SELECT 1; PRAGMA writable_schema = 1', qdt: kw('PRAGMA'), rmt: kw('PRAGMA'), repo: /multiple statements/ },
  { name: 'PRAGMA inside CTE tail', sql: 'WITH a AS (SELECT 1) PRAGMA foo', qdt: kw('PRAGMA'), rmt: kw('PRAGMA'), repo: repoKw('PRAGMA') },
  { name: 'VACUUM', sql: 'WITH a AS (SELECT 1) VACUUM', qdt: kw('VACUUM'), rmt: kw('VACUUM'), repo: repoKw('VACUUM') },
  { name: 'ALTER', sql: 'WITH a AS (SELECT 1) ALTER TABLE x ADD y', qdt: kw('ALTER'), rmt: kw('ALTER'), repo: repoKw('ALTER') },
  { name: 'CREATE', sql: 'WITH a AS (SELECT 1) CREATE TABLE x(y)', qdt: kw('CREATE'), rmt: kw('CREATE'), repo: repoKw('CREATE') },
  { name: 'TRUNCATE', sql: 'SELECT 1 FROM TRUNCATE', qdt: kw('TRUNCATE'), rmt: kw('TRUNCATE'), repo: repoKw('TRUNCATE') },
  { name: 'GRANT', sql: 'SELECT 1 FROM GRANT', qdt: kw('GRANT'), rmt: kw('GRANT'), repo: repoKw('GRANT') },
  { name: 'REVOKE', sql: 'SELECT 1 FROM REVOKE', qdt: kw('REVOKE'), rmt: kw('REVOKE'), repo: repoKw('REVOKE') },
  { name: 'mixed-case keyword', sql: 'WITH a AS (SELECT 1) dRoP TABLE x', qdt: kw('DROP'), rmt: kw('DROP'), repo: repoKw('DROP') },
  { name: 'keyword across newline/tab whitespace', sql: 'WITH a AS (SELECT 1)\n\tDELETE\n FROM x', qdt: kw('DELETE'), rmt: kw('DELETE'), repo: repoKw('DELETE') },

  // ── disagreements (pinned both ways; reported as follow-ups) ──
  // F-1: multiple harmless statements: tools accept, repository rejects.
  { name: 'DISAGREE multi-statement SELECT; SELECT', sql: 'SELECT 1; SELECT 2', qdt: 'ok', rmt: 'ok', repo: /multiple statements/ },
  { name: 'DISAGREE multi-statement with comment between', sql: 'SELECT 1; /* x */ SELECT 2', qdt: 'ok', rmt: 'ok', repo: /multiple statements/ },
  // F-2: REPLACE() scalar: tools accept, repository rejects (keyword).
  { name: 'DISAGREE REPLACE() scalar', sql: "SELECT REPLACE(textContent, 'a', 'b') FROM Message", qdt: 'ok', rmt: 'ok', repo: repoKw('REPLACE') },
  { name: 'REPLACE INTO in CTE tail', sql: 'WITH a AS (SELECT 1) REPLACE INTO Message VALUES (1)', qdt: /REPLACE INTO/, rmt: /REPLACE INTO/, repo: repoKw('REPLACE') },
  { name: 'INSERT OR REPLACE in CTE tail is caught by INSERT keyword', sql: 'WITH a AS (SELECT 1) INSERT OR REPLACE INTO Message VALUES (1)', qdt: kw('INSERT'), rmt: kw('INSERT'), repo: repoKw('INSERT') },
  // F-3: REINDEX: repository rejects, tools accept (not in their denylist).
  { name: 'DISAGREE REINDEX', sql: 'WITH a AS (SELECT 1) REINDEX', qdt: 'ok', rmt: 'ok', repo: repoKw('REINDEX') },
  // F-4: filesystem/side-effect functions: tools reject, repository accepts.
  { name: 'DISAGREE load_extension', sql: "SELECT load_extension('evil.so')", qdt: kw('LOAD_EXTENSION'), rmt: kw('LOAD_EXTENSION'), repo: 'ok' },
  { name: 'DISAGREE readfile', sql: "SELECT readfile('/etc/passwd')", qdt: kw('READFILE'), rmt: kw('READFILE'), repo: 'ok' },
  { name: 'DISAGREE writefile', sql: "SELECT writefile('/tmp/x', 'y')", qdt: kw('WRITEFILE'), rmt: kw('WRITEFILE'), repo: 'ok' },
  { name: 'DISAGREE fsdir', sql: "SELECT * FROM fsdir('/')", qdt: kw('FSDIR'), rmt: kw('FSDIR'), repo: 'ok' },
  { name: 'function name inside literal is ignored', sql: "SELECT 'load_extension'", qdt: 'ok', rmt: 'ok', repo: 'ok' },
  // Unterminated constructs are not stripped; the keyword scan still sees them.
  { name: 'unterminated string hides nothing', sql: "SELECT 'abc DROP", qdt: kw('DROP'), rmt: kw('DROP'), repo: repoKw('DROP') },
  { name: 'unterminated block comment hides nothing', sql: 'SELECT 1 /* DROP', qdt: kw('DROP'), rmt: kw('DROP'), repo: repoKw('DROP') },
]

describe('R-AI-04 read-only SQL guards: characterization', () => {
  describe.each([
    ['QueryDatabaseTool', queryDb, 'qdt'],
    ['ReadMessagesTool', readMsgs, 'rmt'],
    ['MessageQueryRepository', repo, 'repo'],
  ] as const)('%s', (_label, guard, key) => {
    it.each(CASES)('$name', (c) => {
      check(guard, c.sql, c[key])
    })
  })

  it("error messages carry each caller's prefix and wording", () => {
    expect(() => queryDb('DELETE FROM x')).toThrow(/^Query rejected: Only SELECT or WITH\.\.\.SELECT statements are allowed\. Got: "DELETE FROM x\.\.\."/)
    expect(() => readMsgs('DELETE FROM x')).toThrow(/^\[ReadMessagesTool\] Query rejected: Only SELECT/)
    expect(() => repo('DELETE FROM x')).toThrow(/^\[MessageQueryRepository\] Query rejected: only SELECT/)
    expect(() => queryDb('SELECT 1 FROM x WHERE REPLACE INTO')).toThrow(/^Query rejected: Forbidden statement detected — "REPLACE INTO"\. Only read operations are permitted\.$/)
    expect(() => readMsgs('SELECT 1 FROM x WHERE INSERT')).toThrow(/^\[ReadMessagesTool\] Query rejected: Forbidden keyword detected — "INSERT"\. Only read operations are permitted\.$/)
    expect(() => repo('SELECT 1; SELECT 2')).toThrow(/^\[MessageQueryRepository\] Query rejected: multiple statements are not permitted$/)
    expect(() => repo('SELECT 1 WHERE DROP')).toThrow(/^\[MessageQueryRepository\] Query rejected: forbidden keyword "DROP"$/)
  })

  it('repository tolerates null/undefined sql by rejecting as non-SELECT', () => {
    expect(() => repo(undefined as unknown as string)).toThrow(NOT_SELECT_REPO)
  })
})
