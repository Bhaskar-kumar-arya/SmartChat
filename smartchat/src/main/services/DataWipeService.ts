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

  /**
   * Clear every non-system table matching `extraFilter`, atomically.
   *
   * All the DELETEs run inside a single `$transaction`, so a failure part-way
   * through (lock, FK, disk) rolls back to the pre-wipe state instead of leaving
   * the DB half-emptied. `PRAGMA foreign_keys` is a no-op inside a transaction,
   * so it is toggled OFF before and restored ON in a `finally` — otherwise a
   * throw would leave FK enforcement disabled on this pooled connection for the
   * rest of the process. Throws on failure so the caller does not proceed (and
   * does not delete the media folders) on a partial wipe.
   */
  private async wipeTables(extraFilter: string): Promise<void> {
    const tables = await this.prisma.$queryRawUnsafe<{ name: string }[]>(
      `SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name != '_prisma_migrations'${extraFilter}`
    )

    await this.prisma.$executeRawUnsafe('PRAGMA foreign_keys = OFF;')
    try {
      await this.prisma.$transaction(
        tables.map((table) => this.prisma.$executeRawUnsafe(`DELETE FROM "${table.name}";`))
      )
      // sqlite_sequence only exists when a table uses AUTOINCREMENT — tolerate its absence.
      await this.prisma.$executeRawUnsafe('DELETE FROM sqlite_sequence;').catch((err: unknown) => {
        console.warn('[DataWipeService] sqlite_sequence reset skipped:', (err as Error)?.message || err)
      })
    } finally {
      await this.prisma.$executeRawUnsafe('PRAGMA foreign_keys = ON;').catch((err: unknown) => {
        console.error('[DataWipeService] Failed to re-enable foreign_keys:', err)
      })
    }
  }

  async wipeAllData(): Promise<void> {
    await this.wipeTables('')
    this.wipeAllFolders()
    console.log('[DataWipeService] All database tables cleared (including AuthState).')
  }

  async wipeUserDataOnly(): Promise<void> {
    // Clear user data but keep AuthState (credentials etc.)
    await this.wipeTables(" AND name != 'AuthState'")
    this.wipeAllFolders()
    console.log('[DataWipeService] User data tables cleared (AuthState preserved).')
  }
}
