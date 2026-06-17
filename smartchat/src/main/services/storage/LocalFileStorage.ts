import fs from 'fs'
import { join } from 'path'
import { app } from 'electron'

/**
 * LocalFileStorage — Infrastructure adapter for all local filesystem operations.
 *
 * Encapsulates Node's `fs` module and Electron's `app.getPath()` behind a
 * domain-neutral interface, satisfying the Dependency Inversion Principle (DIP).
 * High-level services (e.g. MessageActionService) depend on this abstraction
 * rather than directly coupling to `fs` or Electron internals.
 */
export class LocalFileStorage {
  /**
   * Read the entire contents of a file synchronously.
   */
  readFile(path: string): Buffer {
    return fs.readFileSync(path)
  }

  /**
   * Copy a file from `src` to `dest` synchronously.
   */
  copyFile(src: string, dest: string): void {
    fs.copyFileSync(src, dest)
  }

  /**
   * Delete a file synchronously. Errors are logged as warnings, not thrown,
   * because cleanup failures are non-fatal.
   */
  deleteFile(path: string): void {
    try {
      fs.unlinkSync(path)
    } catch (err) {
      console.warn(`[LocalFileStorage] Failed to delete file at ${path}:`, err)
    }
  }

  /**
   * Ensure a directory exists, creating it (recursively) if necessary.
   */
  ensureDir(path: string): void {
    if (!fs.existsSync(path)) {
      fs.mkdirSync(path, { recursive: true })
    }
  }

  /**
   * Returns `true` if the given path exists on disk.
   */
  exists(path: string): boolean {
    return fs.existsSync(path)
  }

  /**
   * Translates an application-layer URI (e.g. `app://media/foo.jpg`) into an
   * absolute filesystem path inside Electron's `userData` directory.
   *
   * Supported URI schemes:
   *  - `app://media/<filename>`      → `<userData>/media/<filename>`
   *  - `app://favourites/<filename>` → `<userData>/favourites/<filename>`
   *
   * Returns the original string unchanged if no scheme is matched so that
   * callers can safely pass through raw file-system paths as well.
   */
  resolveMediaPath(appUri: string): string {
    if (appUri.startsWith('app://favourites/')) {
      const fileName = appUri.replace('app://favourites/', '')
      return join(app.getPath('userData'), 'favourites', fileName)
    }
    if (appUri.startsWith('app://media/')) {
      const fileName = appUri.replace('app://media/', '')
      return join(app.getPath('userData'), 'media', fileName)
    }
    return appUri
  }

  /**
   * Returns the absolute path to the application's `media` cache directory.
   */
  getMediaDir(): string {
    return join(app.getPath('userData'), 'media')
  }
}
