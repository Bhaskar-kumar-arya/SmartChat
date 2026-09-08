import { describe, it, expect, vi, beforeEach } from 'vitest';

const queryRawUnsafe = vi.fn();
vi.mock('../../auth', () => ({
  prisma: {
    $queryRawUnsafe: (...args: unknown[]) => queryRawUnsafe(...args)
  }
}));

import { QueryDatabaseTool } from '../../tools/QueryDatabaseTool';

describe('QueryDatabaseTool.validateSqlQuery (S12-08)', () => {
  const validate = (sql: string) => (new QueryDatabaseTool() as unknown as { validateSqlQuery(s: string): void }).validateSqlQuery(sql);

  it('does not reject forbidden keywords that appear only inside string literals', () => {
    expect(() => validate("SELECT id FROM Message WHERE textContent LIKE '%please update me%'")).not.toThrow();
    expect(() => validate("SELECT id FROM Message WHERE textContent LIKE '%delete this%' OR textContent LIKE '%create a poll%'")).not.toThrow();
    expect(() => validate("SELECT id FROM Message WHERE textContent LIKE '%grant access%'")).not.toThrow();
  });

  it('still rejects a real write statement', () => {
    expect(() => validate("SELECT 1; DELETE FROM Message")).toThrow(/Forbidden keyword/);
    expect(() => validate("UPDATE Message SET textContent = 'x'")).toThrow();
  });

  it('ignores keywords hidden in comments but still validates the code', () => {
    expect(() => validate("SELECT id FROM Message -- DROP TABLE Message\n WHERE id = '1'")).not.toThrow();
  });

  it('allows the read-only REPLACE() scalar function (P2-S12-05)', () => {
    expect(() => validate("SELECT REPLACE(textContent, x'0a', ' ') AS t FROM Message")).not.toThrow();
  });

  it('still rejects the mutating REPLACE INTO / INSERT OR REPLACE forms (P2-S12-05)', () => {
    expect(() => validate("SELECT 1; REPLACE INTO Message VALUES (1)")).toThrow(/REPLACE INTO/);
    expect(() => validate("SELECT 1; INSERT OR REPLACE INTO Message VALUES (1)")).toThrow(/Forbidden/);
  });

  it('rejects side-effecting filesystem functions (P2-S12-06)', () => {
    expect(() => validate("SELECT load_extension('evil.so')")).toThrow(/LOAD_EXTENSION/);
    expect(() => validate("SELECT readfile('/etc/passwd')")).toThrow(/READFILE/);
    expect(() => validate("SELECT writefile('/tmp/x', 'y')")).toThrow(/WRITEFILE/);
  });
});

describe('QueryDatabaseTool row-cap enforcement (S12-09)', () => {
  beforeEach(() => {
    queryRawUnsafe.mockReset();
    queryRawUnsafe.mockResolvedValue([]);
  });

  it('wraps a query with a trailing line comment so LIMIT is not commented out', async () => {
    const tool = new QueryDatabaseTool();
    await tool.execute({ sql: 'SELECT id FROM Message -- newest first', explanation: 't' });
    const finalSql = queryRawUnsafe.mock.calls[0][0] as string;
    // LIMIT must be on its own line, outside the commented tail
    expect(finalSql).toMatch(/\)\s*AS _capped LIMIT 1500\s*$/);
    expect(finalSql.split('\n').pop()).toMatch(/LIMIT 1500/);
  });

  it('wraps a query that already has its own LIMIT', async () => {
    const tool = new QueryDatabaseTool();
    await tool.execute({ sql: 'SELECT id FROM Message LIMIT 5', explanation: 't' });
    const finalSql = queryRawUnsafe.mock.calls[0][0] as string;
    expect(finalSql).toContain('AS _capped LIMIT 1500');
  });
});
