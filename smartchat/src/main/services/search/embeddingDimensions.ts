/**
 * H-04 (B-AI-03): the single source of truth for the embedding vector size.
 *
 * Every consumer that depends on the dimension (the vec0 DDL, the stale-vector
 * guard in VectorSyncService, the 0003 migration) derives from this constant,
 * which must equal the output size of the model in `embedding.worker.ts`
 * (`Xenova/all-MiniLM-L6-v2`).
 */
export const EMBEDDING_DIMENSIONS = 768

export const vecMessagesDdl = (): string => `
  CREATE VIRTUAL TABLE IF NOT EXISTS vec_messages USING vec0(
    messageId TEXT PRIMARY KEY,
    vector FLOAT[${EMBEDDING_DIMENSIONS}]
  );
`

/** Minimal async raw-SQL executor (Prisma `$executeRawUnsafe` shaped). */
export type RawExec = (sql: string, ...params: unknown[]) => Promise<unknown>

/**
 * Creates `vec_messages`, and recreates it if an existing table was declared
 * with a different dimension (probe with a correctly-sized MATCH query).
 */
export async function ensureVecMessagesTable(exec: RawExec): Promise<void> {
  await exec(vecMessagesDdl())
  try {
    await exec(
      `SELECT count(*) FROM vec_messages WHERE vector MATCH ? AND k=1`,
      JSON.stringify(new Array(EMBEDDING_DIMENSIONS).fill(0))
    )
  } catch (e: unknown) {
    if (!(e as Error).message.includes('Dimension mismatch')) return
    console.warn(
      `[VectorDB] Dimension mismatch detected. Recreating table with ${EMBEDDING_DIMENSIONS} dims...`
    )
    await exec(`DROP TABLE IF EXISTS vec_messages`)
    // S10-04: IF NOT EXISTS so a racing/failed CREATE can't leave no table.
    await exec(vecMessagesDdl())
  }
}
