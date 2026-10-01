import { PrismaClient } from '@prisma/client'
import { app } from 'electron'
import { join } from 'path'
import fs from 'fs'

import { IAIChatSessionService, AIChatMessageInput } from './IAIChatSessionService'

// Path for storing simple preferences like auto-save
const preferencesPath = join(app.getPath('userData'), 'ai_preferences.json')

export class AIChatSessionService implements IAIChatSessionService {
  constructor(private prisma: PrismaClient) {}

  // ── Session CRUD ──
  
  async createSession(title: string, modelId?: string | null) {
    return await this.prisma.aIChatSession.create({
      data: {
        title,
        modelId,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      }
    })
  }

  async listSessions(page: number = 1, pageSize: number = 50) {
    const skip = (page - 1) * pageSize
    const sessions = await this.prisma.aIChatSession.findMany({
      orderBy: { updatedAt: 'desc' },
      skip,
      take: pageSize,
    })
    
    // Convert BigInts to strings for IPC transit
    return sessions.map(s => ({
      ...s,
      createdAt: s.createdAt.toString(),
      updatedAt: s.updatedAt.toString()
    }))
  }

  async getSession(id: string) {
    const session = await this.prisma.aIChatSession.findUnique({
      where: { id },
      include: { 
        messages: {
          orderBy: { orderIndex: 'asc' }
        }
      }
    })

    if (!session) return null

    return {
      ...session,
      createdAt: session.createdAt.toString(),
      updatedAt: session.updatedAt.toString(),
      messages: session.messages.map(m => ({
        ...m,
        contexts: m.contexts ? JSON.parse(m.contexts) : [],
        mentions: m.mentions ? JSON.parse(m.mentions) : []
      }))
    }
  }

  async renameSession(id: string, title: string) {
    const updated = await this.prisma.aIChatSession.update({
      where: { id },
      data: { title, updatedAt: Date.now() }
    })
    
    return {
      ...updated,
      createdAt: updated.createdAt.toString(),
      updatedAt: updated.updatedAt.toString()
    }
  }

  async deleteSession(id: string) {
    await this.prisma.aIChatSession.delete({
      where: { id }
    })
  }

  async cloneSession(id: string) {
    const original = await this.getSession(id)
    if (!original) throw new Error('Session not found')

    const clone = await this.createSession(`${original.title} (Copy)`, original.modelId)
    
    if (original.messages && original.messages.length > 0) {
      await this.saveMessages(
        clone.id,
        original.messages.map(m => ({
          role: m.role as 'user' | 'ai',
          content: m.content,
          contexts: m.contexts,
          mentions: m.mentions,
          isHidden: m.isHidden,
          isSystem: m.isSystem,
          toolResult: m.toolResult ?? undefined,
          hasError: m.hasError
        }))
      )
    }

    return await this.getSession(clone.id)
  }

  // ── Message CRUD ──

  async saveMessages(sessionId: string, messages: AIChatMessageInput[]) {
    // We do a full replacement of messages for the session to handle edits and truncations easily
    await this.prisma.$transaction(async (tx) => {
      // 1. Delete existing messages for this session
      await tx.aIChatMessage.deleteMany({
        where: { sessionId }
      })

      // 2. Insert new messages
      if (messages.length > 0) {
        await tx.aIChatMessage.createMany({
          data: messages.map((m, index) => ({
            sessionId,
            role: m.role,
            content: m.content,
            contexts: m.contexts && m.contexts.length > 0 ? JSON.stringify(m.contexts) : null,
            mentions: m.mentions && m.mentions.length > 0 ? JSON.stringify(m.mentions) : null,
            isHidden: m.isHidden || false,
            isSystem: m.isSystem || false,
            toolResult: m.toolResult || null,
            hasError: m.hasError || false,
            orderIndex: index
          }))
        })
      }

      // 3. Update session's updatedAt
      await tx.aIChatSession.update({
        where: { id: sessionId },
        data: { updatedAt: Date.now() }
      })
    })
  }

  // ── Settings ──

  /**
   * `trusted` is false when the file exists but could not be read/parsed. In that
   * case the returned defaults are for display only and must never be persisted
   * (F-AI-5: doing so erased externalApiToken/externalApiPort).
   */
  private readPreferences(): { prefs: Record<string, unknown>; trusted: boolean } {
    try {
      if (fs.existsSync(preferencesPath)) {
        const data = fs.readFileSync(preferencesPath, 'utf-8')
        const parsed = JSON.parse(data)
        if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
          return { prefs: parsed, trusted: true }
        }
        console.error('AI preferences file is not a JSON object; not overwriting it')
        return { prefs: { autoSaveChats: true }, trusted: false }
      }
    } catch (e) {
      console.error('Failed to read AI preferences (will not overwrite it):', e)
      return { prefs: { autoSaveChats: true }, trusted: false }
    }
    return { prefs: { autoSaveChats: true }, trusted: true } // Default true as requested
  }

  /** Read-modify-write against the freshest on-disk state; refuses when the file is unreadable. */
  private updatePreferences(patch: Record<string, unknown>): void {
    const { prefs, trusted } = this.readPreferences()
    if (!trusted) return
    this.writePreferences({ ...prefs, ...patch })
  }

  private writePreferences(prefs: Record<string, unknown>) {
    try {
      fs.writeFileSync(preferencesPath, JSON.stringify(prefs, null, 2))
    } catch (e) {
      console.error('Failed to write AI preferences:', e)
    }
  }

  async getAIOptions(): Promise<{ useThinkMode: boolean; model: string; contextLength: number; autoSaveChats: boolean }> {
    const { prefs } = this.readPreferences()
    return {
      useThinkMode: prefs.useThinkMode !== false,
      model: (typeof prefs.model === 'string' && prefs.model) || 'gemini:gemma-4-31b-it',
      contextLength: (typeof prefs.contextLength === 'number' && prefs.contextLength) || 24576,
      autoSaveChats: prefs.autoSaveChats !== false
    }
  }

  async setAIOptions(options: Record<string, unknown>): Promise<void> {
    // Only the four renderer-owned keys, with the right types, may be set here.
    // Everything else (externalApiToken, externalApiPort, ...) is not renderer-writable.
    const patch: Record<string, unknown> = {}
    if (typeof options?.useThinkMode === 'boolean') patch.useThinkMode = options.useThinkMode
    if (typeof options?.model === 'string') patch.model = options.model
    if (typeof options?.contextLength === 'number' && Number.isFinite(options.contextLength)) {
      patch.contextLength = options.contextLength
    }
    if (typeof options?.autoSaveChats === 'boolean') patch.autoSaveChats = options.autoSaveChats
    if (Object.keys(patch).length === 0) return
    this.updatePreferences(patch)
  }

  async getAutoSavePreference(): Promise<boolean> {
    const { prefs } = this.readPreferences()
    return prefs.autoSaveChats !== false // Default true
  }

  async setAutoSavePreference(enabled: boolean): Promise<void> {
    this.updatePreferences({ autoSaveChats: enabled })
  }
}
