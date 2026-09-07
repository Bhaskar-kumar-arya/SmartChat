import { describe, it, expect } from 'vitest';
// eslint-disable-next-line @typescript-eslint/no-require-imports
const Database = require('better-sqlite3');
import { runMigrations, RawSqliteDb } from '../../db/schema-migrations';

function freshDb(): RawSqliteDb {
  return new Database(':memory:') as RawSqliteDb;
}

describe('runMigrations (S12-07)', () => {
  it('is idempotent — a second run does not throw', () => {
    const db = freshDb();
    runMigrations(db);
    expect(() => runMigrations(db)).not.toThrow();
  });

  it('does not throw a UNIQUE violation when a racer already recorded the migration', () => {
    const db = freshDb();
    // Simulate the losing process: bookkeeping table + row already present,
    // DDL already applied by the winner.
    db.exec(`
      CREATE TABLE IF NOT EXISTS "_schema_migrations" ("id" TEXT NOT NULL PRIMARY KEY, "applied_at" INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS "Extension" ("id" TEXT NOT NULL PRIMARY KEY, "name" TEXT NOT NULL, "version" TEXT NOT NULL, "enabled" INTEGER NOT NULL DEFAULT 1, "installedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP);
    `);
    db.prepare('INSERT INTO "_schema_migrations" ("id","applied_at") VALUES (?,?)').run('0001_extension_tables', Date.now());
    expect(() => runMigrations(db)).not.toThrow();
  });

  it('sets a non-zero busy_timeout', () => {
    const db = freshDb();
    runMigrations(db);
    const row = db.prepare('PRAGMA busy_timeout').all() as Array<{ timeout: number }>;
    expect(row[0].timeout).toBeGreaterThan(0);
  });

  it('creates the expected tables', () => {
    const db = freshDb();
    runMigrations(db);
    const tables = (db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all() as Array<{ name: string }>).map(r => r.name);
    expect(tables).toEqual(expect.arrayContaining(['Extension', 'ExtensionKV', 'Citation']));
  });
});
