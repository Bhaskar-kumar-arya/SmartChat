import fs from 'fs'
import { join } from 'path'


export class AIChatExportService {
  private getExportPath(): string {
    return join(process.cwd(), 'ai_chats_export.json')
  }

  async exportChat(session: any, messages: any[]): Promise<void> {
    const filePath = this.getExportPath()
    let exports: any[] = []

    if (fs.existsSync(filePath)) {
      try {
        const content = fs.readFileSync(filePath, 'utf8')
        exports = JSON.parse(content)
      } catch (e) {
        console.error('Failed to parse export file, starting fresh', e)
      }
    }

    // Check if session already exists in exports to update it, or append
    const existingIndex = exports.findIndex((e: any) => e.sessionId === session.id)
    
    const exportData = {
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

    fs.writeFileSync(filePath, JSON.stringify(exports, null, 2), 'utf8')
  }

  async deleteExportedChat(sessionId: string): Promise<void> {
    const filePath = this.getExportPath()
    if (!fs.existsSync(filePath)) return

    try {
      const content = fs.readFileSync(filePath, 'utf8')
      let exports = JSON.parse(content)
      exports = exports.filter((e: any) => e.sessionId !== sessionId)
      fs.writeFileSync(filePath, JSON.stringify(exports, null, 2), 'utf8')
    } catch (e) {
      console.error('Failed to delete exported chat', e)
    }
  }

  async duplicateExportedChat(sessionId: string): Promise<void> {
    const filePath = this.getExportPath()
    if (!fs.existsSync(filePath)) return

    try {
      const content = fs.readFileSync(filePath, 'utf8')
      let exports = JSON.parse(content)
      const target = exports.find((e: any) => e.sessionId === sessionId)
      
      if (target) {
        const copy = JSON.parse(JSON.stringify(target))
        copy.sessionId = `copy-${Date.now()}`
        copy.title = `${copy.title} (Copy)`
        copy.exportedAt = new Date().toISOString()
        exports.push(copy)
        fs.writeFileSync(filePath, JSON.stringify(exports, null, 2), 'utf8')
      }
    } catch (e) {
      console.error('Failed to duplicate exported chat', e)
    }
  }
}

export const aiChatExportService = new AIChatExportService()
