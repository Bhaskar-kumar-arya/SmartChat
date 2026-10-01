import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import * as fs from 'fs'
import * as os from 'os'
import { join } from 'path'
import Database from 'better-sqlite3'
import * as sqliteVec from 'sqlite-vec'
import { WorkerConnectionManager } from '../../../../workers/whatsapp/socket/workerConnectionManager'

/**
 * Batch D — Slice 1 regressions.
 *
 * S1-01: reconnect paths invoked connect() as a floating promise. A rejection
 *        (transient Prisma error during a reconnect) killed the reconnect chain
 *        silently — worker stayed offline until app restart.
 * S1-02: wipeAllData ran per-table DELETEs with no transaction and skipped
 *        `PRAGMA foreign_keys = ON` on any error, leaving FK enforcement off
 *        for the rest of the connection's life and the DB half-wiped.
 */

function makeManager(): WorkerConnectionManager {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return new WorkerConnectionManager({ publish: vi.fn() } as any)
}

describe('WorkerConnectionManager — S1-01 reconnect error handling', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  it('reschedules another reconnect when a reconnect attempt rejects', async () => {
    const manager = makeManager()
    const connect = vi
      .spyOn(manager, 'connect')
      .mockRejectedValueOnce(new Error('transient DB lock'))
      .mockResolvedValueOnce(undefined)

    // scheduleReconnect is private — exercised via the reconnect callback path.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ;(manager as any).scheduleReconnect(1000)

    await vi.advanceTimersByTimeAsync(1000)
    expect(connect).toHaveBeenCalledTimes(1)

    // First attempt rejected -> a second attempt must have been scheduled.
    await vi.advanceTimersByTimeAsync(2000)
    expect(connect).toHaveBeenCalledTimes(2)
  })

  it('caps the exponential backoff at the max delay', async () => {
    const manager = makeManager()
    const connect = vi.spyOn(manager, 'connect').mockRejectedValue(new Error('still down'))

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ;(manager as any).scheduleReconnect(40_000)
    await vi.advanceTimersByTimeAsync(40_000)
    expect(connect).toHaveBeenCalledTimes(1)

    // next delay is min(40000*2, 60000) = 60000
    await vi.advanceTimersByTimeAsync(59_999)
    expect(connect).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(1)
    expect(connect).toHaveBeenCalledTimes(2)
  })
})

describe('WorkerConnectionManager — S1-02 wipeAllData atomicity', () => {
  function makePrisma(txImpl: (ops: unknown[]) => Promise<unknown>) {
    const execCalls: string[] = []
    const prisma = {
      $queryRawUnsafe: vi.fn().mockResolvedValue([{ name: 'Chat' }, { name: 'Message' }]),
      $executeRawUnsafe: vi.fn((sql: string) => {
        execCalls.push(sql)
        return Promise.resolve(0)
      }),
      $transaction: vi.fn(txImpl)
    }
    return { prisma, execCalls }
  }

  it('wipes every table inside a single $transaction', async () => {
    const manager = makeManager()
    const { prisma } = makePrisma((_ops: unknown[]) => Promise.resolve([]))

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (manager as any).wipeAllData(prisma, 'C:/tmp/does-not-exist-userdata')

    expect(prisma.$transaction).toHaveBeenCalledTimes(1)
    const ops = prisma.$transaction.mock.calls[0][0]
    expect(Array.isArray(ops)).toBe(true)
    expect(ops).toHaveLength(2) // one DELETE per table, atomic
  })

  it('restores PRAGMA foreign_keys = ON even when the wipe transaction fails', async () => {
    const manager = makeManager()
    const { prisma, execCalls } = makePrisma((_ops: unknown[]) =>
      Promise.reject(new Error('disk I/O error'))
    )

    await expect(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (manager as any).wipeAllData(prisma, 'C:/tmp/does-not-exist-userdata')
    ).rejects.toThrow('disk I/O error')

    expect(execCalls).toContain('PRAGMA foreign_keys = OFF;')
    expect(execCalls).toContain('PRAGMA foreign_keys = ON;')
  })
})

/**
 * B-WA-02: the worker wipe deleted every sqlite_master table, including the
 * `vec0` virtual table (and its shadow tables) created by the main process.
 * The worker never loads sqlite-vec, so `DELETE FROM "vec_messages"` throws
 * `no such module: vec0`, the transaction rolls back (AuthState included) and a
 * phone-side unlink loops on dead creds forever. Real SQLite file, with the
 * extension loaded only while creating the schema (like main) and NOT when wiping.
 */
describe('WorkerConnectionManager — B-WA-02 wipe with vec0 virtual table', () => {
  let dir: string
  beforeEach(() => {
    dir = fs.mkdtempSync(join(os.tmpdir(), 'wipe-vec-'))
  })
  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true })
  })

  it.fails('wipes real tables and leaves the vec0 table alone when the extension is not loaded', async () => {
    const dbPath = join(dir, 'test.db')
    const setup = new Database(dbPath)
    sqliteVec.load(setup)
    setup.exec(`
      CREATE TABLE AuthState (id TEXT PRIMARY KEY, data TEXT);
      CREATE TABLE Chat (id TEXT PRIMARY KEY);
      CREATE VIRTUAL TABLE vec_messages USING vec0(messageId TEXT PRIMARY KEY, vector FLOAT[4]);
      INSERT INTO AuthState VALUES ('creds', 'x');
      INSERT INTO Chat VALUES ('c1');
    `)
    setup.close()

    // Worker-side connection: no sqlite-vec loaded.
    const db = new Database(dbPath)
    const prisma = {
      $queryRawUnsafe: vi.fn(async (sql: string) => db.prepare(sql).all()),
      // Lazy like Prisma's PrismaPromise: runs only when awaited, so inside
      // $transaction the statements execute between BEGIN and COMMIT/ROLLBACK.
      $executeRawUnsafe: vi.fn((sql: string) => {
        const run = (): Promise<number> =>
          new Promise((resolve, reject) => {
            try {
              resolve(db.prepare(sql).run().changes)
            } catch (e) {
              reject(e)
            }
          })
        return {
          then: (a: never, b: never) => run().then(a, b),
          catch: (b: never) => run().catch(b)
        }
      }),
      $transaction: vi.fn(async (ops: PromiseLike<unknown>[]) => {
        db.exec('BEGIN')
        try {
          for (const op of ops) await op
          db.exec('COMMIT')
        } catch (e) {
          db.exec('ROLLBACK')
          throw e
        }
      })
    }

    const manager = makeManager()
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await (manager as any).wipeAllData(prisma, join(dir, 'userdata'))

      expect(db.prepare('SELECT count(*) AS n FROM AuthState').get()).toEqual({ n: 0 })
      expect(db.prepare('SELECT count(*) AS n FROM Chat').get()).toEqual({ n: 0 })
    } finally {
      db.close()
    }
  })
})
