/**
 * WAEventLogger
 * =============
 * Writes every Baileys event (and any ad-hoc data you want to inspect) as a
 * newline-delimited JSON record (JSONL) to:
 *
 *   <project-root>/logs/wa_events_<YYYY-MM-DD>.jsonl
 *
 * One file per calendar day so logs stay manageable.
 * Each record looks like:
 *
 *   {
 *     "ts":        "2026-05-15T01:23:45.678Z",   // ISO timestamp
 *     "event":     "messages.upsert",             // Baileys event name (or custom label)
 *     "count":     3,                             // items in payload array (1 for objects)
 *     "keys":      ["messages","messages.key",…], // all dot-path keys in the payload
 *     "payload":   { … }                          // sanitised full payload (Buffers redacted, BigInts stringified)
 *   }
 *
 * Usage in WhatsAppConnectionManager:
 *   import { waEventLogger } from './WAEventLogger'
 *
 *   // Inside ev.process():
 *   for (const [name, data] of Object.entries(events)) {
 *     waEventLogger.log(name, data)
 *   }
 *
 *   // Ad-hoc call anywhere:
 *   waEventLogger.log('groupFetchAllParticipating:result', groups)
 */

import fs from 'fs'
import path from 'path'

// ─── Helpers ─────────────────────────────────────────────────────────────────

/**
 * JSON replacer that makes Baileys payloads serialisable:
 *  - BigInt  → string (keeps numeric value)
 *  - Buffer  → "<Buffer N bytes>" (avoids multi-MB base64 blobs)
 *  - Uint8Array/ArrayBuffer → "<Buffer N bytes>"
 */
function safeReplacer(_key: string, value: unknown): unknown {
  if (typeof value === 'bigint') return value.toString()
  if (Buffer.isBuffer(value)) return `<Buffer ${value.length} bytes>`
  if (value instanceof Uint8Array) return `<Uint8Array ${value.length} bytes>`
  if (value instanceof ArrayBuffer) return `<ArrayBuffer ${value.byteLength} bytes>`
  return value
}

/**
 * Recursively collects every dot-notation key path present in a value.
 * Arrays are sampled (first element only) so you still see the shape without
 * repeating the same paths for every element.
 *
 * maxDepth guards against very deep proto messages (default: 8).
 */
function collectKeyPaths(obj: unknown, prefix = '', depth = 0, maxDepth = 8): string[] {
  if (depth > maxDepth || obj == null || typeof obj !== 'object') return []

  // For arrays, sample the first element as representative
  const target: unknown = Array.isArray(obj) ? obj[0] : obj
  if (target == null || typeof target !== 'object') return []

  const paths: string[] = []
  for (const key of Object.keys(target as object)) {
    const full = prefix ? `${prefix}.${key}` : key
    paths.push(full)
    const child = (target as Record<string, unknown>)[key]
    // Recurse into plain objects; skip Buffers to avoid noise
    if (child != null && typeof child === 'object' && !Buffer.isBuffer(child) && !(child instanceof Uint8Array)) {
      paths.push(...collectKeyPaths(child, full, depth + 1, maxDepth))
    }
  }
  return paths
}

// ─── Logger class ─────────────────────────────────────────────────────────────

class WAEventLogger {
  private logsDir: string | null = null   // resolved lazily on first write
  private currentDate = ''
  private currentFile = ''
  private stream: fs.WriteStream | null = null

  constructor() {
    // Do NOT touch app or __dirname here — app may not be ready yet.
    // logsDir is resolved on first write in resolveLogsDir().
  }

  /**
   * Resolves (and caches) the logs directory path.
   *
   * Strategy:
   *  - Dev  (`npm run dev`): process.cwd() is always the project root.
   *  - Prod (packaged):      app.getPath('userData') puts logs in AppData,
   *                          next to the DB, easy to find.
   */
  private resolveLogsDir(): string {
    if (this.logsDir) return this.logsDir

    try {
      const { app: electronApp } = require('electron') as typeof import('electron')
      if (electronApp?.isPackaged) {
        // Packaged: store logs in userData (same place as the SQLite DB)
        this.logsDir = path.join(electronApp.getPath('userData'), 'logs')
      } else {
        // Dev: process.cwd() === project root when running `npm run dev`
        this.logsDir = path.join(process.cwd(), 'dev_only', 'logs')
      }
    } catch {
      // Fallback: always works
      this.logsDir = path.join(process.cwd(), 'dev_only', 'logs')
    }

    try {
      if (!fs.existsSync(this.logsDir)) {
        fs.mkdirSync(this.logsDir, { recursive: true })
      }
    } catch (err) {
      console.error('[WAEventLogger] Could not create logs dir:', err)
    }

    console.log(`[WAEventLogger] Logging to: ${this.logsDir}`)
    return this.logsDir
  }

  /** Returns (and opens if needed) a write stream for today's log file. */
  private getStream(): fs.WriteStream | null {
    const logsDir = this.resolveLogsDir()
    const today = new Date().toISOString().slice(0, 10) // YYYY-MM-DD
    if (today !== this.currentDate || !this.stream) {
      // Close previous stream
      try { this.stream?.end() } catch { /* ignore */ }
      this.currentDate = today
      this.currentFile = path.join(logsDir, `wa_events_${today}.jsonl`)
      try {
        this.stream = fs.createWriteStream(this.currentFile, { flags: 'a', encoding: 'utf8' })
        this.stream.on('error', (err) => console.error('[WAEventLogger] Stream error:', err))
      } catch (err) {
        console.error('[WAEventLogger] Could not open log file:', err)
        return null
      }
    }
    return this.stream
  }

  /**
   * Log any event or ad-hoc data as a JSONL record.
   *
   * @param eventName   Baileys event name or any descriptive label
   * @param data        The raw payload — arrays, objects, anything
   * @param extra       Optional extra key-value metadata to include in the record
   */
  log(eventName: string, data: unknown, extra?: Record<string, unknown>): void {
    try {
      const stream = this.getStream()
      if (!stream) return

      const isArray = Array.isArray(data)
      const count = isArray ? (data as unknown[]).length : 1
      const keys = collectKeyPaths(data)

      let sanitised: unknown
      try {
        sanitised = JSON.parse(JSON.stringify(data, safeReplacer))
      } catch {
        sanitised = '<not serialisable>'
      }

      const record: Record<string, unknown> = {
        ts: new Date().toISOString(),
        event: eventName,
        count,
        keys,
        payload: sanitised,
        ...extra
      }

      const line = JSON.stringify(record) + '\n'
      stream.write(line) // non-blocking
    } catch (err) {
      // Logger must never crash the main process
      console.error('[WAEventLogger] Error writing log:', err)
    }
  }

  /**
   * Log all events from a Baileys ev.process() batch in one call.
   * Usage:
   *   sock.ev.process(async (events) => {
   *     waEventLogger.logBatch(events)
   *     // … your handlers …
   *   })
   */
  logBatch(events: Record<string, unknown>): void {
    for (const [name, data] of Object.entries(events)) {
      this.log(name, data)
    }
  }

  /** Returns the path to today's log file (useful for IPC / debug panels). */
  get currentLogFile(): string {
    this.resolveLogsDir() // ensure initialised
    return this.currentFile
  }

  /** Flush and close the current stream (call on app quit). */
  close(): void {
    try { this.stream?.end() } catch { /* ignore */ }
    this.stream = null
  }
}

// ─── Singleton export ─────────────────────────────────────────────────────────

export const waEventLogger = new WAEventLogger()
