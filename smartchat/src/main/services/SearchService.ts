import { prisma } from '../auth'
import { contactService } from './ContactService'

export interface SearchResultItem {
  type: 'chat' | 'message'
  jid: string
  name: string
  lastMessage?: string
  messageId?: string
  snippet?: string
  timestamp?: string
}

export interface SearchResults {
  chats: SearchResultItem[]
  messages: SearchResultItem[]
}

/**
 * SearchService is responsible solely for full-text search across the database.
 * Single Responsibility Principle: this service does not handle chat CRUD or messaging.
 */
export class SearchService {
  /**
   * Searches all chats/contacts by name or JID, and all messages by text content.
   * @param query - The raw search string from the user
   * @param sock  - The active Baileys socket, used for name resolution
   */
  async searchAll(query: string, sock: any): Promise<SearchResults> {
    const q = query.trim()
    if (!q) return { chats: [], messages: [] }

    // ── 1. Search chats by resolved name or jid ──────────────────────
    const allChats = await prisma.chat.findMany()

    // Resolve names in bulk for all chats (reuse ContactService)
    const allJids = allChats.map((c) => c.jid)
    const nameMap = await contactService.batchResolveNames(allJids, sock)

    const matchingChats = allChats.filter((chat) => {
      const name = nameMap.get(chat.jid) || chat.jid.split('@')[0]
      return (
        name.toLowerCase().includes(q.toLowerCase()) ||
        chat.jid.toLowerCase().includes(q.toLowerCase())
      )
    })

    // Enrich matching chats with last message preview
    const chatResults: SearchResultItem[] = await Promise.all(
      matchingChats.map(async (chat) => {
        const name = nameMap.get(chat.jid) || chat.jid.split('@')[0]
        const lastMsg = await prisma.message.findFirst({
          where: { remoteJid: chat.jid },
          orderBy: { timestamp: 'desc' },
          select: { textContent: true, messageType: true, timestamp: true }
        })
        return {
          type: 'chat' as const,
          jid: chat.jid,
          name,
          lastMessage:
            lastMsg?.messageType === 'stickerMessage'
              ? 'Sticker'
              : lastMsg?.messageType === 'imageMessage'
                ? 'Photo'
                : lastMsg?.messageType === 'videoMessage'
                  ? 'Video'
                  : lastMsg?.messageType === 'documentMessage'
                    ? 'Document'
                    : lastMsg?.textContent || '',
          timestamp: lastMsg?.timestamp?.toString()
        }
      })
    )

    // ── 2. Search messages by text content ────────────────────────────
    const matchingMessages = await prisma.message.findMany({
      where: {
        textContent: { contains: q }
      },
      orderBy: { timestamp: 'desc' },
      take: 30
    })

    // Collect JIDs to resolve names
    const msgJids = [...new Set(matchingMessages.map((m) => m.remoteJid))]
    const msgNameMap = await contactService.batchResolveNames(msgJids, sock)

    const messageResults: SearchResultItem[] = matchingMessages.map((msg) => {
      const name = msgNameMap.get(msg.remoteJid) || msg.remoteJid.split('@')[0]
      return {
        type: 'message' as const,
        jid: msg.remoteJid,
        name,
        messageId: msg.id,
        snippet: msg.textContent || '',
        timestamp: msg.timestamp?.toString()
      }
    })

    return { chats: chatResults, messages: messageResults }
  }
}

export const searchService = new SearchService()
