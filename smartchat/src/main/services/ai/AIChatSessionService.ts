import { prisma as globalPrisma } from '../../auth'
import { PrismaClient } from '@prisma/client'
import { app } from 'electron'
import { join } from 'path'
import fs from 'fs'

// Path for storing simple preferences like auto-save
const preferencesPath = join(app.getPath('userData'), 'ai_preferences.json')

interface AIChatMessageInput {
  role: 'user' | 'ai'
  content: string
  contexts?: any[]
  mentions?: any[]
  isHidden?: boolean
  isSystem?: boolean
  toolResult?: string
  hasError?: boolean
}

export class AIChatSessionService {
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

  private readPreferences() {
    try {
      if (fs.existsSync(preferencesPath)) {
        const data = fs.readFileSync(preferencesPath, 'utf-8')
        return JSON.parse(data)
      }
    } catch (e) {
      console.error('Failed to read AI preferences:', e)
    }
    return { autoSaveChats: true } // Default true as requested
  }

  private writePreferences(prefs: any) {
    try {
      fs.writeFileSync(preferencesPath, JSON.stringify(prefs, null, 2))
    } catch (e) {
      console.error('Failed to write AI preferences:', e)
    }
  }

  async getAIOptions(): Promise<any> {
    const prefs = this.readPreferences()
    return {
      useThinkMode: prefs.useThinkMode !== false,
      model: prefs.model || 'gemini:gemma-4-31b-it',
      contextLength: prefs.contextLength || 24576,
      autoSaveChats: prefs.autoSaveChats !== false
    }
  }

  async setAIOptions(options: any): Promise<void> {
    const prefs = this.readPreferences()
    const updated = { ...prefs, ...options }
    this.writePreferences(updated)
  }

  async getAutoSavePreference(): Promise<boolean> {
    const prefs = this.readPreferences()
    return prefs.autoSaveChats !== false // Default true
  }

  async setAutoSavePreference(enabled: boolean): Promise<void> {
    const prefs = this.readPreferences()
    prefs.autoSaveChats = enabled
    this.writePreferences(prefs)
  }
}

export const aiChatSessionService = new AIChatSessionService(globalPrisma)
