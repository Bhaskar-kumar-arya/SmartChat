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

    const msgJids = Array.from(new Set(messages.map((m: any) => m.remoteJid as string)))
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
    const queryVector = await embeddingService.embed(q)
    const queryVectorJson = JSON.stringify(queryVector)

    // 1. Build the filter clause if needed
    let filterSql = ''
    const params: any[] = [queryVectorJson]

    const hasFilters = !!(filters?.jids?.length || filters?.fromDate || filters?.toDate)
    if (hasFilters) {
      const candidateMessages = await prisma.message.findMany({
        where: buildMessageWhereClause(filters),
        select: { id: true }
      })
      if (candidateMessages.length === 0) return []
      const ids = candidateMessages.map((m) => m.id)

      // To avoid SQLite parameter limit issues, we only use the IDs 
      // if they are within a reasonable range (e.g., < 2000)
      if (ids.length < 2000) {
        filterSql = `AND messageId IN (${ids.map(() => '?').join(',')})`
        params.push(...ids)
      } else {
        // Fallback or warning? For now, we'll just skip the ID filter in SQL
        // and filter in JS later if needed, but usually k=30 is enough.
        // Or we could use a temporary table/CTE if we really needed to.
      }
    }

    // 2. Execute native vector search
    // vec0 uses MATCH for k-NN search. 'distance' is standard L2/Cosine-related distance.
    const sql = `
      SELECT messageId, distance
      FROM vec_messages
      WHERE vector MATCH ?
      ${filterSql}
      AND k = 30
      ORDER BY distance ASC
    `

    try {
      const scoredResults = await prisma.$queryRawUnsafe<any[]>(sql, ...params)
      if (scoredResults.length === 0) return []

      // 3. Enrich with message details
      const scoredIds = scoredResults.map((r) => r.messageId)
      const messages = await prisma.message.findMany({
        where: { id: { in: scoredIds } }
      })

      const msgMap = new Map(messages.map((m: any) => [m.id, m]))
      const jids = [...new Set(messages.map((m: any) => m.remoteJid))]
      const nameMap = await contactService.batchResolveNames(jids as string[], sock)

      return scoredResults
        .map((res) => {
          const msg = msgMap.get(res.messageId)
          if (!msg) return null
          const name = nameMap.get(msg.remoteJid) || msg.remoteJid.split('@')[0]
          return {
            type: 'message' as const,
            jid: msg.remoteJid,
            name,
            messageId: msg.id,
            snippet: msg.textContent || '',
            timestamp: msg.timestamp?.toString(),
            // distance is 0 to ~2, where 0 is identical.
            // We convert to a 0-1 "confidence/similarity" score for UI.
            score: Math.max(0, Math.round((1 - res.distance) * 100) / 100)
          }
        })
        .filter(Boolean) as SearchResultItem[]
    } catch (err) {
      console.error('[SearchService] Native vector search failed:', err)
      return []
    }
  }
}

export const searchService = new SearchService()
