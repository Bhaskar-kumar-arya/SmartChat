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
      $executeRawUnsafe: vi.fn().mockReturnValue(Promise.resolve())
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
    
  })

  it('wipeUserDataOnly clears tables except AuthState', async () => {
    await service.wipeUserDataOnly()
    expect(prisma.$queryRawUnsafe).toHaveBeenCalledWith(expect.stringContaining("AND name != 'AuthState'"))
    expect(prisma.$executeRawUnsafe).toHaveBeenCalledWith('DELETE FROM "Identity";')
  })
})
