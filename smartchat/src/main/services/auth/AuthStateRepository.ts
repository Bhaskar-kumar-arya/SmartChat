import { PrismaClient } from '@prisma/client'
import { IAuthStateRepository } from './IAuthStateRepository'

/**
 * AuthStateRepository — Encapsulates database read/write queries
 * for the `AuthState` table.
 */
export class AuthStateRepository implements IAuthStateRepository {
  constructor(private readonly prisma: PrismaClient) {}

  /**
   * Fetches the data string for a given key.
   */
  async getValue(key: string): Promise<string | null> {
    try {
      const row = await this.prisma.authState.findUnique({
        where: { id: key }
      })
      // `findUnique` resolves to `null` for a genuinely absent row — that is the
      // only case we report as "no value". A thrown error means the query
      // failed (DB locked, I/O, adapter): we must NOT swallow it into `null`,
      // because callers like `hasCreds()` would then treat a logged-in user as
      // logged-out and wipe their data. Fail closed — rethrow.
      return row?.data ?? null
    } catch (err: unknown) {
      console.error(`[AuthStateRepository] Failed to getValue for key ${key}:`, err)
      throw err
    }
  }

  /**
   * Sets/upserts the data string for a given key.
   */
  async setValue(key: string, value: string): Promise<void> {
    try {
      await this.prisma.authState.upsert({
        where: { id: key },
        update: { data: value },
        create: { id: key, data: value }
      })
    } catch (err: unknown) {
      console.error(`[AuthStateRepository] Failed to setValue for key ${key}:`, err)
      throw err
    }
  }

  /**
   * Deletes the row for a given key (no-op if it doesn't exist).
   */
  async deleteValue(key: string): Promise<void> {
    try {
      await this.prisma.authState.deleteMany({ where: { id: key } })
    } catch (err: unknown) {
      console.error(`[AuthStateRepository] Failed to deleteValue for key ${key}:`, err)
    }
  }
}
