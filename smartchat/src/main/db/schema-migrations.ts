/**
 * schema-migrations.ts
 * ====================
 * Lightweight, append-only schema migration tracker for the SmartChat SQLite database.
 *
 * WHY THIS EXISTS
 * ---------------
 * The app bootstraps production databases by copying a pre-built `template.db` on
 * first launch. That works perfectly for new installs, but existing users whose
 * `dev.db` pre-dates a schema addition will never receive the new tables.
 *
 * This module fixes that gap by maintaining a `_schema_migrations` table that
 * records which DDL migrations have been applied. On each startup it runs any
 * pending migrations in order, inside individual transactions.
 *
 * HOW TO ADD A NEW MIGRATION
 * --------------------------
 * 1. Add the model/column to `prisma/schema.prisma` (keeps Prisma client in sync).
 * 2. Append ONE new entry to the `MIGRATIONS` array below. Use a monotone ID,
 *    e.g. `0002_my_new_table`. Write plain SQLite DDL using `CREATE TABLE IF NOT EXISTS`.
 * 3. Run `npm run build` — `generate-template.js` will regenerate `resources/template.db`
 *    so new installs also get the table from day one.
 *
 * GUARANTEES
 * ----------
 * - Idempotent: each migration is applied at most once (tracked by ID).
 * - Ordered: migrations run in array order.
 * - Atomic: each migration runs in its own transaction; a failure rolls back only
 *   that migration and throws, so the startup can surface the error clearly.
 * - Synchronous: runs in the `connect` hook before any Prisma query fires.
 */

/** Minimal interface over the raw better-sqlite3 Database instance. */
export interface RawSqliteDb {
  prepare(sql: string): {
    all(...params: unknown[]): unknown[]
    run(...params: unknown[]): void
  }
  exec(sql: string): void
  transaction<T>(fn: () => T): () => T
  close(): void
}

import { canonicalShaHex } from '../services/messages/shaUtils'

/** A single schema migration entry. */
interface Migration {
  /** Unique, human-readable ID — used as the primary key in _schema_migrations. */
  id: string
  /** One or more DDL statements to execute, separated by semicolons. */
  sql?: string
  /**
   * Optional imperative step for data migrations that cannot be expressed as
   * plain SQLite DDL (e.g. re-encoding a column value in JS). Runs inside the
   * same per-migration transaction as `sql`, after it. Must be idempotent.
   */
  run?: (db: RawSqliteDb) => void
}

/** True when the given table exists in the connected database. */
function tableExists(db: RawSqliteDb, name: string): boolean {
  return (
    db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name = ?").all(name) as unknown[]
  ).length > 0
}

/**
 * P2-S2-06 data migration: `FavoriteSticker.fileSha256` is the lookup key for a
 * favorited sticker. It was historically stored base64-encoded; the canonical
 * encoding is now lowercase hex (matching the cache filename and every call
 * site). Rewrite any legacy base64 key to hex so existing favorites keep
 * matching. `fileName` is left untouched — the on-disk favourites file keeps its
 * original name and is still located via that column.
 */
function migrateFavoriteStickerShaToHex(db: RawSqliteDb): void {
  if (!tableExists(db, 'FavoriteSticker')) return

  const rows = db
    .prepare('SELECT id, fileSha256 FROM "FavoriteSticker"')
    .all() as Array<{ id: string; fileSha256: string }>

  for (const row of rows) {
    const current = row.fileSha256
    // Already canonical hex (64 lowercase hex chars) — nothing to do. This makes
    // the migration safe to re-run and a no-op for fresh installs.
    if (/^[0-9a-f]{64}$/.test(current)) continue

    const hex = canonicalShaHex(current)
    if (!hex || hex === current) continue

    // A hex-keyed row for the same sticker may already exist (e.g. re-favorited
    // after the encoding change). Drop the stale base64 duplicate rather than
    // hit the UNIQUE constraint.
    const clash =
      (db.prepare('SELECT 1 FROM "FavoriteSticker" WHERE fileSha256 = ?').all(hex) as unknown[])
        .length > 0
    if (clash) {
      db.prepare('DELETE FROM "FavoriteSticker" WHERE id = ?').run(row.id)
      continue
    }

    db.prepare('UPDATE "FavoriteSticker" SET fileSha256 = ? WHERE id = ?').run(hex, row.id)
  }
}

// ── MIGRATION REGISTRY ────────────────────────────────────────────────────────
// Append new entries at the END. Never modify or delete existing entries.
const MIGRATIONS: Migration[] = [
  {
    id: '0001_extension_tables',
    sql: `
      CREATE TABLE IF NOT EXISTS "Extension" (
        "id"          TEXT     NOT NULL PRIMARY KEY,
        "name"        TEXT     NOT NULL,
        "version"     TEXT     NOT NULL,
        "enabled"     INTEGER  NOT NULL DEFAULT 1,
        "installedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS "ExtensionKV" (
        "extensionId" TEXT     NOT NULL,
        "key"         TEXT     NOT NULL,
        "value"       TEXT     NOT NULL,
        "updatedAt"   DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY ("extensionId", "key")
      );

      CREATE TABLE IF NOT EXISTS "ExtensionChatMessage" (
        "id"          TEXT     NOT NULL PRIMARY KEY,
        "extensionId" TEXT     NOT NULL,
        "role"        TEXT     NOT NULL,
        "content"     TEXT     NOT NULL,
        "createdAt"   DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS "Citation" (
        "sessionId"   TEXT     NOT NULL,
        "index"       INTEGER  NOT NULL,
        "type"        TEXT     NOT NULL,
        "payload"     TEXT     NOT NULL,
        PRIMARY KEY ("sessionId", "index")
      );
    `
  },
  {
    id: '0002_favorite_sticker_sha_hex',
    run: migrateFavoriteStickerShaToHex
  }
  // ↑ Add future migrations above this comment.
]

// ── RUNNER ────────────────────────────────────────────────────────────────────

/**
 * Ensures the `_schema_migrations` bookkeeping table exists, then applies every
 * migration in `MIGRATIONS` that has not yet been recorded. Safe to call from
 * multiple processes (main + worker) because each migration is guarded by a
 * `CREATE TABLE IF NOT EXISTS` and a unique-ID check.
 *
 * @param db - The raw better-sqlite3 Database instance exposed by the Prisma adapter.
 */
export function runMigrations(db: RawSqliteDb): void {
  // 0. On first launch the main process and the WhatsApp worker can both run
  //    this concurrently against the same file. Give SQLite a busy timeout so
  //    the loser waits for the winner's write transaction instead of failing
  //    immediately with SQLITE_BUSY. (No-op if already set on this connection.)
  try {
    db.exec('PRAGMA busy_timeout = 10000;')
  } catch (err) {
    console.warn('[Migrations] Could not set busy_timeout:', err)
  }

  // 1. Bootstrap the bookkeeping table if this is a brand-new or legacy DB.
  db.exec(`
    CREATE TABLE IF NOT EXISTS "_schema_migrations" (
      "id"         TEXT    NOT NULL PRIMARY KEY,
      "applied_at" INTEGER NOT NULL
    );
  `)

  // 2. Fetch already-applied migration IDs.
  const applied = new Set(
    (db.prepare('SELECT id FROM "_schema_migrations"').all() as Array<{ id: string }>).map(
      (r) => r.id
    )
  )

  // 3. Run pending migrations in order.
  for (const migration of MIGRATIONS) {
    if (applied.has(migration.id)) {
      continue
    }

    console.log(`[Migrations] Applying migration: ${migration.id}`)

    const applyMigration = db.transaction(() => {
      // Re-check inside the transaction: a racing process (main vs worker) may
      // have applied this migration between our SELECT above and acquiring the
      // write lock here.
      const alreadyApplied =
        (
          db
            .prepare('SELECT 1 FROM "_schema_migrations" WHERE id = ?')
            .all(migration.id) as unknown[]
        ).length > 0
      if (alreadyApplied) return

      // Execute the DDL (may contain multiple statements separated by semicolons).
      // All statements use `CREATE TABLE IF NOT EXISTS`, so a partial apply by
      // the racer is harmless.
      if (migration.sql) db.exec(migration.sql)

      // Imperative data step (must be idempotent — a racer may run it too).
      if (migration.run) migration.run(db)

      // Record the migration as applied. `OR IGNORE` so a concurrent winner's
      // row doesn't turn this into a UNIQUE-violation abort.
      db.prepare(
        'INSERT OR IGNORE INTO "_schema_migrations" ("id", "applied_at") VALUES (?, ?)'
      ).run(migration.id, Date.now())
    })

    try {
      applyMigration()
      console.log(`[Migrations] Successfully applied: ${migration.id}`)
    } catch (err) {
      console.error(`[Migrations] Failed to apply migration "${migration.id}":`, err)
      throw err // Bubble up — a failed migration is a startup-blocking error.
    }
  }
}
