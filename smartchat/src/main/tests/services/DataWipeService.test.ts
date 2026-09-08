import { describe, it, expect, vi, beforeEach } from 'vitest'
import { DataWipeService } from '../../services/DataWipeService'

import * as fs from 'fs'

vi.mock('fs')

vi.mock('electron', () => ({
  app: {
    getPath: vi.fn().mockReturnValue('/mock/userData')
  }
}))

describe('DataWipeService', () => {
  let service: DataWipeService
  let prisma: any

  beforeEach(() => {
    vi.mocked(fs.existsSync).mockReturnValue(true)
    prisma = {
      $queryRawUnsafe: vi.fn().mockResolvedValue([{ name: 'Identity' }, { name: 'Message' }]),
      $executeRawUnsafe: vi.fn().mockReturnValue(Promise.resolve()),
      $transaction: vi.fn((ops: Promise<unknown>[]) => Promise.all(ops))
    }
    service = new DataWipeService(prisma)
  })

  it('wipeAllData clears all tables and folders', async () => {
    await service.wipeAllData()
    expect(prisma.$queryRawUnsafe).toHaveBeenCalledWith(expect.stringContaining("AND name NOT LIKE 'sqlite_%'"))
    expect(prisma.$executeRawUnsafe).toHaveBeenCalledWith('PRAGMA foreign_keys = OFF;')
    expect(prisma.$executeRawUnsafe).toHaveBeenCalledWith('DELETE FROM "Identity";')
    expect(prisma.$executeRawUnsafe).toHaveBeenCalledWith('DELETE FROM "Message";')
    expect(prisma.$executeRawUnsafe).toHaveBeenCalledWith('DELETE FROM sqlite_sequence;')
    expect(prisma.$executeRawUnsafe).toHaveBeenCalledWith('PRAGMA foreign_keys = ON;')
    expect(prisma.$transaction).toHaveBeenCalled()
  })

  it('wipeUserDataOnly clears tables except AuthState', async () => {
    await service.wipeUserDataOnly()
    expect(prisma.$queryRawUnsafe).toHaveBeenCalledWith(expect.stringContaining("AND name != 'AuthState'"))
    expect(prisma.$executeRawUnsafe).toHaveBeenCalledWith('DELETE FROM "Identity";')
  })

  it('runs the table DELETEs inside a single transaction', async () => {
    await service.wipeAllData()
    // the per-table DELETEs must be handed to $transaction, not fired loose
    const txArg = prisma.$transaction.mock.calls[0][0]
    expect(Array.isArray(txArg)).toBe(true)
    expect(txArg).toHaveLength(2) // Identity + Message
  })

  it('P2-S12-02: a folder that cannot be cleared makes wipeAllData reject (no silent partial wipe)', async () => {
    // clearDirectory returns the count of entries it could not delete (e.g. a
    // media file locked by another process on Windows). Any non-zero count must
    // surface as a rejection rather than a logged-and-ignored partial wipe.
    ;(service as unknown as { getUserDataPath(): string }).getUserDataPath = () => '/mock/userData'
    ;(service as unknown as { clearDirectory(p: string): number }).clearDirectory = (p: string) =>
      p.endsWith('media') ? 3 : 0
    await expect(service.wipeAllData()).rejects.toThrow(/Incomplete data wipe/)
  })

  it('P2-S12-02: wipeAllData resolves when every folder clears cleanly', async () => {
    ;(service as unknown as { getUserDataPath(): string }).getUserDataPath = () => '/mock/userData'
    ;(service as unknown as { clearDirectory(p: string): number }).clearDirectory = () => 0
    await expect(service.wipeAllData()).resolves.toBeUndefined()
  })

  it('S12-05: a failed DELETE aborts the wipe — throws, restores foreign_keys, skips folder wipe', async () => {
    prisma.$executeRawUnsafe.mockImplementation((sql: string) => {
      if (sql === 'DELETE FROM "Message";') return Promise.reject(new Error('database is locked'))
      return Promise.resolve()
    })

    await expect(service.wipeAllData()).rejects.toThrow('database is locked')

    // foreign_keys must be turned back ON even on the failure path
    expect(prisma.$executeRawUnsafe).toHaveBeenCalledWith('PRAGMA foreign_keys = ON;')
    // the media / favourites folders must NOT be wiped when the DB wipe failed
    expect(fs.rmSync).not.toHaveBeenCalled()
  })
})
