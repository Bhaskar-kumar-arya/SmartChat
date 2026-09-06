import fs from 'fs'
import { join } from 'path'
import { app } from 'electron'
import { IAIChatExportService, ExportSession, ExportMessage } from './IAIChatExportService'

export interface ExportedChatData {
  sessionId: string
  title: string
  model?: string | null
  exportedAt: string
  messages: Array<{
    role: string
    content: string
    timestamp: string | number
  }>
}

export class AIChatExportService implements IAIChatExportService {
  private getExportPath(): string {
    // Must live under userData — in a packaged Electron app process.cwd() is
    // not the app dir (can be `/`, System32, or a read-only location).
    return join(app.getPath('userData'), 'ai_chats_export.json')
  }

  /**
   * Reads the export file. On a JSON parse error (or a non-array payload) it
   * preserves the bad file as `<path>.corrupt-<ts>` and throws, rather than
   * silently continuing with `[]` and letting the next write destroy every
   * previously exported chat.
   */
  private readExports(filePath: string): ExportedChatData[] {
    if (!fs.existsSync(filePath)) return []
    const content = fs.readFileSync(filePath, 'utf8')
    let parsed: unknown
    try {
      parsed = JSON.parse(content)
    } catch (e) {
      const backup = `${filePath}.corrupt-${Date.now()}`
      try {
        fs.writeFileSync(backup, content, 'utf8')
      } catch {
        /* best effort */
      }
      throw new Error(`Export file is corrupt; preserved a copy at ${backup}. Original error: ${String(e)}`)
    }
    if (!Array.isArray(parsed)) {
      const backup = `${filePath}.corrupt-${Date.now()}`
      try {
        fs.writeFileSync(backup, content, 'utf8')
      } catch {
        /* best effort */
      }
      throw new Error(`Export file is not a JSON array; preserved a copy at ${backup}.`)
    }
    return parsed as ExportedChatData[]
  }

  /** Atomic write: write to a temp file then rename over the target. */
  private writeExports(filePath: string, exports: ExportedChatData[]): void {
    const tmp = `${filePath}.tmp-${process.pid}-${Date.now()}`
    fs.writeFileSync(tmp, JSON.stringify(exports, null, 2), 'utf8')
    fs.renameSync(tmp, filePath)
  }

  async exportChat(session: ExportSession, messages: ExportMessage[]): Promise<void> {
    const filePath = this.getExportPath()
    const exports = this.readExports(filePath)

    // Check if session already exists in exports to update it, or append
    const existingIndex = exports.findIndex((e) => e.sessionId === session.id)

    const exportData: ExportedChatData = {
      sessionId: session.id,
      title: session.title,
      model: session.modelId,
      exportedAt: new Date().toISOString(),
      messages: messages.map(m => ({
        role: m.role,
        content: m.content,
        timestamp: m.timestamp || new Date().toISOString()
      }))
    }

    if (existingIndex >= 0) {
      exports[existingIndex] = exportData
    } else {
      exports.push(exportData)
    }

    this.writeExports(filePath, exports)
  }

  async deleteExportedChat(sessionId: string): Promise<void> {
    const filePath = this.getExportPath()
    if (!fs.existsSync(filePath)) return

    const exports = this.readExports(filePath).filter((e) => e.sessionId !== sessionId)
    this.writeExports(filePath, exports)
  }

  async duplicateExportedChat(sessionId: string): Promise<void> {
    const filePath = this.getExportPath()
    if (!fs.existsSync(filePath)) return

    const exports = this.readExports(filePath)
    const target = exports.find((e) => e.sessionId === sessionId)
    if (!target) return

    const copy: ExportedChatData = JSON.parse(JSON.stringify(target))
    copy.sessionId = `copy-${Date.now()}`
    copy.title = `${copy.title} (Copy)`
    copy.exportedAt = new Date().toISOString()
    exports.push(copy)
    this.writeExports(filePath, exports)
  }
}
