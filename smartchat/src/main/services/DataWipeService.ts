import { PrismaClient } from '@prisma/client'
import { IDataWipeService } from './IDataWipeService'

export class DataWipeService implements IDataWipeService {
  constructor(private prisma: PrismaClient) {}

  private clearDirectory(dirPath: string): void {
    try {
      const fs = require('fs')
      if (fs.existsSync(dirPath)) {
        fs.rmSync(dirPath, { recursive: true, force: true })
        fs.mkdirSync(dirPath, { recursive: true })
      }
    } catch (e) {
      console.error(`[DataWipeService] Failed to clear directory ${dirPath}:`, e)
    }
  }

  private wipeAllFolders(): void {
    try {
      const { app } = require('electron')
      const path = require('path')
      const userDataPath = app.getPath('userData')
      this.clearDirectory(path.join(userDataPath, 'favourites'))
      this.clearDirectory(path.join(userDataPath, 'media'))
      this.clearDirectory(path.join(userDataPath, 'temp'))
      this.clearDirectory(path.join(userDataPath, 'temp_stickers'))
    } catch (e) {
      console.error('[DataWipeService] Failed to clear folders:', e)
    }
  }

  async wipeAllData(): Promise<void> {
    try {
      const tables = await this.prisma.$queryRawUnsafe<{ name: string }[]>(
        "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name != '_prisma_migrations'"
      )

      await this.prisma.$executeRawUnsafe('PRAGMA foreign_keys = OFF;')
      for (const table of tables) {
        await this.prisma.$executeRawUnsafe(`DELETE FROM "${table.name}";`)
      }
      await this.prisma.$executeRawUnsafe("DELETE FROM sqlite_sequence;").catch((err: unknown) => {
        console.warn('[DataWipeService] sqlite_sequence reset skipped:', (err as Error)?.message || err)
      })
      await this.prisma.$executeRawUnsafe('PRAGMA foreign_keys = ON;')
    } catch (err) {
      console.error('[DataWipeService] Failed to dynamically clear tables:', err)
    }
    
    this.wipeAllFolders()
    console.log('[DataWipeService] All database tables cleared (including AuthState).')
  }

  async wipeUserDataOnly(): Promise<void> {
    try {
      // Clear user data but keep AuthState (credentials etc.)
      const tables = await this.prisma.$queryRawUnsafe<{ name: string }[]>(
        "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name != '_prisma_migrations' AND name != 'AuthState'"
      )

      await this.prisma.$executeRawUnsafe('PRAGMA foreign_keys = OFF;')
      for (const table of tables) {
        await this.prisma.$executeRawUnsafe(`DELETE FROM "${table.name}";`)
      }
      await this.prisma.$executeRawUnsafe("DELETE FROM sqlite_sequence;").catch((err: unknown) => {
        console.warn('[DataWipeService] sqlite_sequence reset skipped:', (err as Error)?.message || err)
      })
      await this.prisma.$executeRawUnsafe('PRAGMA foreign_keys = ON;')
    } catch (err) {
      console.error('[DataWipeService] Failed to dynamically clear tables:', err)
    }
    
    this.wipeAllFolders()
    console.log('[DataWipeService] User data tables cleared (AuthState preserved).')
  }
}

