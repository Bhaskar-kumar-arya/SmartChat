import { describe, it, expect, afterEach } from 'vitest'
import * as sqliteVec from 'sqlite-vec'
import {
  EMBEDDING_DIMENSIONS,
  ensureVecMessagesTable,
  type RawExec
} from '../../services/search/embeddingDimensions'
// eslint-disable-next-line @typescript-eslint/no-require-imports
const Database = require('better-sqlite3')

/** Output size of Xenova/all-MiniLM-L6-v2, the model embedding.worker.ts loads. */
const MODEL_OUTPUT_DIMENSIONS = 384

type Db = {
  exec(sql: string): void
  prepare(sql: string): { all(...p: unknown[]): unknown[]; run(...p: unknown[]): unknown }
  close(): void
}

const open: Db[] = []
function vecDb(): { db: Db; exec: RawExec } {
  const db = new Database(':memory:') as Db
  sqliteVec.load(db as never)
  open.push(db)
  const exec: RawExec = async (sql, ...params) =>
    params.length ? db.prepare(sql).all(...params) : db.exec(sql)
  return { db, exec }
}
const vec = (n: number): string => JSON.stringify(new Array(n).fill(0.1))
const insert = (db: Db, n: number): unknown =>
  db.prepare('INSERT INTO vec_messages(messageId, vector) VALUES (?, ?)').run('m1', vec(n))

afterEach(() => {
  while (open.length) open.pop()?.close()
})

describe('vec_messages dimension contract (H-04 / B-AI-03)', () => {
  it('creates a table that accepts vectors of EMBEDDING_DIMENSIONS', async () => {
    const { db, exec } = vecDb()
    await ensureVecMessagesTable(exec)
    expect(() => insert(db, EMBEDDING_DIMENSIONS)).not.toThrow()
  })

  it('recreates a table declared with a different dimension', async () => {
    const { db, exec } = vecDb()
    db.exec('CREATE VIRTUAL TABLE vec_messages USING vec0(messageId TEXT PRIMARY KEY, vector FLOAT[128])')
    await ensureVecMessagesTable(exec)
    expect(() => insert(db, EMBEDDING_DIMENSIONS)).not.toThrow()
  })

  it('leaves a correctly-sized table (and its rows) intact', async () => {
    const { db, exec } = vecDb()
    await ensureVecMessagesTable(exec)
    insert(db, EMBEDDING_DIMENSIONS)
    await ensureVecMessagesTable(exec)
    expect(db.prepare('SELECT count(*) AS c FROM vec_messages').all()).toEqual([{ c: 1 }])
  })

  it.fails('the shared constant matches the embedding model output (384)', () => {
    expect(EMBEDDING_DIMENSIONS).toBe(MODEL_OUTPUT_DIMENSIONS)
  })

  it.fails('a real model-dimension vector can be inserted into the vec table', async () => {
    const { db, exec } = vecDb()
    await ensureVecMessagesTable(exec)
    expect(() => insert(db, MODEL_OUTPUT_DIMENSIONS)).not.toThrow()
  })
})
