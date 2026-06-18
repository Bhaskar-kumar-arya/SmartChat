import { PrismaClient } from '@prisma/client'

/**
 * AuthStateRepository — Encapsulates database read/write queries
 * for the `AuthState` table.
 */
export class AuthStateRepository {
  constructor(private readonly prisma: PrismaClient) {}

  /**
   * Fetches the data string for a given key.
   */
  async getValue(key: string): Promise<string | null> {
    try {
      const row = await this.prisma.authState.findUnique({
        where: { id: key }
      })
      return row?.data ?? null
    } catch (err: unknown) {
      console.error(`[AuthStateRepository] Failed to getValue for key ${key}:`, err)
      return null
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
}
