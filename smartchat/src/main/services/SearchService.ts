import { prisma } from '../auth'
import { contactService } from './ContactService'
import { embeddingService } from './EmbeddingService'

// ── Shared types ──────────────────────────────────────────────────────────────

export interface SearchResultItem {
  type: 'chat' | 'message'
  jid: string
  name: string
  lastMessage?: string
  messageId?: string
  snippet?: string
  timestamp?: string
  score?: number // 0–1 cosine similarity (deep mode only)
}

export interface SearchResults {
  chats: SearchResultItem[]
  messages: SearchResultItem[]
}

export interface SearchFilters {
  jids?: string[] // restrict to these chat JIDs
  fromDate?: Date // timestamp range start (inclusive)
  toDate?: Date // timestamp range end (inclusive)
}

export type SearchMode = 'normal' | 'deep'

// ── Interface (OCP: callers depend on abstraction, not concrete class) ────────

export interface ISearchService {
  searchAll(query: string, mode: SearchMode, sock: any, filters?: SearchFilters): Promise<SearchResults>
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function buildTimestampFilter(filters?: SearchFilters): { gte?: bigint; lte?: bigint } | undefined {
  if (!filters?.fromDate && !filters?.toDate) return undefined
  const clause: { gte?: bigint; lte?: bigint } = {}
  if (filters?.fromDate) clause.gte = BigInt(Math.floor(filters.fromDate.getTime() / 1000))
  if (filters?.toDate) clause.lte = BigInt(Math.floor(filters.toDate.getTime() / 1000))
  return clause
}

function buildMessageWhereClause(filters?: SearchFilters, extraWhere: Record<string, any> = {}) {
  const tsFilter = buildTimestampFilter(filters)
  return {
    textContent: { not: null },
    ...(filters?.jids?.length ? { remoteJid: { in: filters.jids } } : {}),
    ...(tsFilter ? { timestamp: tsFilter } : {}),
    ...extraWhere
  }
}

/**
 * SearchService handles both normal (keyword) and deep (vector) search.
 * SRP: search logic only — no chat CRUD, no messaging.
 * OCP: new modes can be added without changing callers.
 * DIP: depends on IEmbeddingService, not the concrete class.
 */
export class SearchService implements ISearchService {
  async searchAll(
    query: string,
    mode: SearchMode,
    sock: any,
    filters?: SearchFilters
  ): Promise<SearchResults> {
    const q = query.trim()
    if (!q) return { chats: [], messages: [] }

    // ── 1. Search chats by name/jid (same for both modes) ──────────────────
    const allChats = await prisma.chat.findMany(
      filters?.jids?.length ? { where: { jid: { in: filters.jids } } } : undefined
    )
    const allJids = allChats.map((c) => c.jid)
    const nameMap = await contactService.batchResolveNames(allJids, sock)

    const matchingChats = allChats.filter((chat) => {
      const name = nameMap.get(chat.jid) || chat.jid.split('@')[0]
      return (
        name.toLowerCase().includes(q.toLowerCase()) ||
        chat.jid.toLowerCase().includes(q.toLowerCase())
      )
    })

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
            lastMsg?.messageType === 'stickerMessage' ? 'Sticker' :
            lastMsg?.messageType === 'imageMessage' ? 'Photo' :
            lastMsg?.messageType === 'videoMessage' ? 'Video' :
            lastMsg?.messageType === 'documentMessage' ? 'Document' :
            lastMsg?.textContent || '',
          timestamp: lastMsg?.timestamp?.toString()
        }
      })
    )

    // ── 2. Search messages ─────────────────────────────────────────────────
    const messageResults =
      mode === 'deep'
        ? await this.deepSearch(q, sock, filters)
        : await this.normalSearch(q, sock, filters)

    return { chats: chatResults, messages: messageResults }
  }

  // ── Normal: keyword LIKE search ──────────────────────────────────────────

  private async normalSearch(
    q: string,
    sock: any,
    filters?: SearchFilters
  ): Promise<SearchResultItem[]> {
    const where = buildMessageWhereClause(filters, {
      textContent: { contains: q }
    })

    const messages = await prisma.message.findMany({
      where,
      orderBy: { timestamp: 'desc' },
      take: 30
    })

    const msgJids = [...new Set(messages.map((m) => m.remoteJid))]
    const msgNameMap = await contactService.batchResolveNames(msgJids, sock)

    return messages.map((msg) => ({
      type: 'message' as const,
      jid: msg.remoteJid,
      name: msgNameMap.get(msg.remoteJid) || msg.remoteJid.split('@')[0],
      messageId: msg.id,
      snippet: msg.textContent || '',
      timestamp: msg.timestamp?.toString()
    }))
  }

  // ── Deep: full vector scan ───────────────────────────────────────────────

  private async deepSearch(
    q: string,
    sock: any,
    filters?: SearchFilters
  ): Promise<SearchResultItem[]> {
    // 1. Get candidate message IDs that pass the filters
    const candidateMessages = await prisma.message.findMany({
      where: buildMessageWhereClause(filters),
      select: { id: true, remoteJid: true, textContent: true, timestamp: true }
    })

    if (candidateMessages.length === 0) return []

    const candidateIds = candidateMessages.map((m) => m.id)

    // 2. Load and score vectors in batches to avoid Prisma/SQLite limits
    const queryVector = await embeddingService.embed(q)
    const BATCH_SIZE = 5000
    const scored: { messageId: string; score: number }[] = []

    for (let i = 0; i < candidateIds.length; i += BATCH_SIZE) {
      const batchIds = candidateIds.slice(i, i + BATCH_SIZE)
      const storedVectors = await (prisma as any).messageVector.findMany({
        where: { messageId: { in: batchIds } }
      })

      for (const sv of storedVectors) {
        try {
          const vec = JSON.parse(sv.vector)
          const score = embeddingService.cosineSimilarity(queryVector, vec)
          scored.push({ messageId: sv.messageId, score })
        } catch (err) {
          // ignore corrupted vectors
        }
      }

      // Optimization: Keep only top 100 if we have too many, to save memory
      if (scored.length > 5000) {
        scored.sort((a, b) => b.score - a.score)
        scored.splice(100)
      }
    }

    if (scored.length === 0) return []

    // 3. Sort descending and take top 30
    scored.sort((a, b) => b.score - a.score)
    const top30 = scored.slice(0, 30)

    // 6. Enrich with message data
    const msgMap = new Map(candidateMessages.map((m) => [m.id, m]))
    const jids = [...new Set(top30.map((s) => msgMap.get(s.messageId)?.remoteJid).filter(Boolean) as string[])]
    const nameMap = await contactService.batchResolveNames(jids, sock)

    return top30.map(({ messageId, score }) => {
      const msg = msgMap.get(messageId)!
      const name = nameMap.get(msg.remoteJid) || msg.remoteJid.split('@')[0]
      return {
        type: 'message' as const,
        jid: msg.remoteJid,
        name,
        messageId,
        snippet: msg.textContent || '',
        timestamp: msg.timestamp?.toString(),
        score: Math.round(score * 100) / 100
      }
    })
  }
}

export const searchService = new SearchService()
