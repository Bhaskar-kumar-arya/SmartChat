import { PrismaClient } from '@prisma/client'
import { IDataWipeService } from './IDataWipeService'

export class DataWipeService implements IDataWipeService {
  constructor(private prisma: PrismaClient) {}

  /**
   * Recursively delete every file/subdir under `dirPath`, then recreate the
   * empty dir. Returns the number of entries that could NOT be removed (e.g. a
   * media file held open by a thumbnailer / AV scanner on Windows → EBUSY).
   * A non-zero return means the on-disk wipe is incomplete — the caller must
   * surface that rather than reporting success.
   */
  private clearDirectory(dirPath: string): number {
    const fs = require('fs')
    if (!fs.existsSync(dirPath)) return 0

    // First try the fast path.
    try {
      fs.rmSync(dirPath, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 })
      fs.mkdirSync(dirPath, { recursive: true })
      return 0
    } catch (e) {
      console.error(`[DataWipeService] rmSync failed for ${dirPath}, falling back to per-file unlink:`, e)
    }

    // Fallback: unlink entries individually so one locked file doesn't leave the
    // whole tree behind, and count what survived.
    let failures = 0
    const walk = (target: string): void => {
      let stat
      try {
        stat = fs.lstatSync(target)
      } catch {
        return
      }
      if (stat.isDirectory()) {
        for (const entry of fs.readdirSync(target)) {
          const path = require('path')
          walk(path.join(target, entry))
        }
        if (target !== dirPath) {
          try {
            fs.rmdirSync(target)
          } catch {
            failures++
          }
        }
      } else {
        try {
          fs.rmSync(target, { force: true, maxRetries: 3, retryDelay: 100 })
        } catch (e) {
          failures++
          console.error(`[DataWipeService] Could not delete ${target}:`, e)
        }
      }
    }
    walk(dirPath)
    try {
      fs.mkdirSync(dirPath, { recursive: true })
    } catch {
      /* dir still exists — fine */
    }
    return failures
  }

  /** Resolve the Electron userData directory; returns null if unavailable. */
  private getUserDataPath(): string | null {
    try {
      const { app } = require('electron')
      return app.getPath('userData')
    } catch (e) {
      console.error('[DataWipeService] Could not resolve userData path for folder wipe:', e)
      return null
    }
  }

  private wipeAllFolders(): void {
    const path = require('path')
    const userDataPath = this.getUserDataPath()
    if (!userDataPath) return
    const dirs = ['favourites', 'media', 'temp', 'temp_stickers']

    const failedDirs: string[] = []
    for (const name of dirs) {
      let survived = 0
      try {
        survived = this.clearDirectory(path.join(userDataPath, name))
      } catch (e) {
        survived = -1
        console.error(`[DataWipeService] Failed to clear ${name}:`, e)
      }
      if (survived !== 0) failedDirs.push(name)
    }

    if (failedDirs.length > 0) {
      throw new Error(
        `[DataWipeService] Incomplete data wipe: could not fully clear on-disk folder(s): ${failedDirs.join(', ')}. ` +
          `Some cached media may still be present (files may be locked by another process).`
      )
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
