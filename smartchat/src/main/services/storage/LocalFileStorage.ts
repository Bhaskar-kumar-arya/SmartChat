import fs from 'fs'
import { join, basename, resolve, sep } from 'path'
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
    const scheme = appUri.startsWith('app://favourites/')
      ? { prefix: 'app://favourites/', dir: 'favourites' }
      : appUri.startsWith('app://media/')
        ? { prefix: 'app://media/', dir: 'media' }
        : null

    if (!scheme) {
      return appUri
    }

    // Reduce to a bare basename and reject anything that still looks like a
    // traversal attempt — the raw value can originate from persisted message
    // `content` (`localURI`), so a crafted `app://media/..\..\x.exe` must not
    // resolve outside the managed directory. (P2-S12-03)
    let rawName: string
    try {
      rawName = decodeURIComponent(appUri.slice(scheme.prefix.length))
    } catch {
      rawName = appUri.slice(scheme.prefix.length)
    }
    const fileName = basename(rawName)
    if (
      !fileName ||
      fileName !== rawName ||
      fileName === '.' ||
      fileName === '..' ||
      fileName.includes('/') ||
      fileName.includes('\\') ||
      fileName.includes('\0')
    ) {
      throw new Error(`[LocalFileStorage] Rejected unsafe media URI: ${appUri}`)
    }

    const baseDir = resolve(join(app.getPath('userData'), scheme.dir))
    const resolved = resolve(join(baseDir, fileName))
    if (resolved !== join(baseDir, fileName) || !resolved.startsWith(baseDir + sep)) {
      throw new Error(`[LocalFileStorage] Rejected out-of-directory media URI: ${appUri}`)
    }
    return resolved
  }

  /**
   * Returns the absolute path to the application's `media` cache directory.
   */
  getMediaDir(): string {
    return join(app.getPath('userData'), 'media')
  }
}
