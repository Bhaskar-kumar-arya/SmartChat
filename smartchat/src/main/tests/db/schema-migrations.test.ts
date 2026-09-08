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

  describe('0002_favorite_sticker_sha_hex (P2-S2-06)', () => {
    const sha = Buffer.from([1, 2, 3, 250, 255, 0, 42, 17, 9, 9]);
    const base64 = sha.toString('base64');
    const hex = sha.toString('hex');

    function dbWithFavoriteTable(): RawSqliteDb {
      const db = freshDb();
      db.exec(`
        CREATE TABLE "FavoriteSticker" (
          "id" TEXT NOT NULL PRIMARY KEY,
          "fileSha256" TEXT NOT NULL UNIQUE,
          "fileName" TEXT NOT NULL,
          "createdAt" BIGINT NOT NULL
        );
      `);
      return db;
    }

    it('rewrites a legacy base64 key to canonical hex, keeping fileName', () => {
      const db = dbWithFavoriteTable();
      db.prepare('INSERT INTO "FavoriteSticker" VALUES (?,?,?,?)').run('a', base64, `hash_${base64}.webp`, 1);

      runMigrations(db);

      const rows = db.prepare('SELECT * FROM "FavoriteSticker"').all() as Array<{ fileSha256: string; fileName: string }>;
      expect(rows).toHaveLength(1);
      expect(rows[0].fileSha256).toBe(hex);
      expect(rows[0].fileName).toBe(`hash_${base64}.webp`);
    });

    it('is idempotent and a no-op for already-hex rows', () => {
      const db = dbWithFavoriteTable();
      db.prepare('INSERT INTO "FavoriteSticker" VALUES (?,?,?,?)').run('a', hex, 'hash_x.webp', 1);

      runMigrations(db);
      runMigrations(db);

      const rows = db.prepare('SELECT fileSha256 FROM "FavoriteSticker"').all() as Array<{ fileSha256: string }>;
      expect(rows.map(r => r.fileSha256)).toEqual([hex]);
    });

    it('drops the legacy base64 row when a hex row for the same sticker already exists', () => {
      const db = dbWithFavoriteTable();
      db.prepare('INSERT INTO "FavoriteSticker" VALUES (?,?,?,?)').run('old', base64, 'hash_old.webp', 1);
      db.prepare('INSERT INTO "FavoriteSticker" VALUES (?,?,?,?)').run('new', hex, 'hash_new.webp', 2);

      expect(() => runMigrations(db)).not.toThrow();

      const rows = db.prepare('SELECT id, fileSha256 FROM "FavoriteSticker"').all() as Array<{ id: string; fileSha256: string }>;
      expect(rows).toEqual([{ id: 'new', fileSha256: hex }]);
    });

    it('does not throw when the FavoriteSticker table is absent (legacy DB)', () => {
      const db = freshDb();
      expect(() => runMigrations(db)).not.toThrow();
    });
  });
});
