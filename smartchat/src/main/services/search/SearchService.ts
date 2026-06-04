import { prisma } from '../../auth'
import { contactService } from '../contacts/ContactService'
import { embeddingService } from './EmbeddingService'

export interface SearchResultItem {
  type: 'chat' | 'message'
  jid: string
  name: string
  lastMessage?: string
  messageId?: string
  snippet?: string
  timestamp?: string
  score?: number
}

export interface SearchResults {
  chats: SearchResultItem[]
  messages: SearchResultItem[]
}

export interface SearchFilters {
  jids?: string[]
  fromDate?: Date
  toDate?: Date
}

export type SearchMode = 'normal' | 'deep'

export interface ISearchService {
  searchAll(query: string, mode: SearchMode, sock: any, filters?: SearchFilters): Promise<SearchResults>
}

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
    ...(filters?.jids?.length ? { chatJid: { in: filters.jids } } : {}),
    ...(tsFilter ? { timestamp: tsFilter } : {}),
    ...extraWhere
  }
}

export class SearchService implements ISearchService {
  async searchAll(
    query: string,
    mode: SearchMode,
    sock: any,
    filters?: SearchFilters
  ): Promise<SearchResults> {
    const q = query.trim()
    if (!q) return { chats: [], messages: [] }

    // ── 1. Search chats ────────────────────────────────────────────────────────
    const allChats = await prisma.chat.findMany(
      filters?.jids?.length ? { where: { jid: { in: filters.jids } } } : undefined
    )
    
    // We only need to resolve names for DMs that lack a name
    const jidsToResolve = allChats.filter(c => !c.name && c.type === 'DM').map(c => c.jid)
    const nameMap = await contactService.batchResolveNames(jidsToResolve, sock)

    const matchingChats = allChats.filter((chat) => {
      const name = chat.name || nameMap.get(chat.jid) || chat.jid.split('@')[0]
      return (
        name.toLowerCase().includes(q.toLowerCase()) ||
        chat.jid.toLowerCase().includes(q.toLowerCase())
      )
    })

    const chatResults: SearchResultItem[] = await Promise.all(
      matchingChats.map(async (chat) => {
        const name = chat.name || nameMap.get(chat.jid) || chat.jid.split('@')[0]
        const lastMsg = await prisma.message.findFirst({
          where: { chatJid: chat.jid },
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

  private async normalSearch(
    q: string,
    _sock: any,
    filters?: SearchFilters
  ): Promise<SearchResultItem[]> {
    const where = buildMessageWhereClause(filters, {
      textContent: { contains: q }
    })

    const messages = await prisma.message.findMany({
      where,
      orderBy: { timestamp: 'desc' },
      take: 30,
      include: { chat: true, sender: true }
    })

    return messages.map((msg: any) => {
        let name = msg.chat?.name
        if (!name && msg.chat?.type === 'DM' && msg.sender) {
            name = msg.sender.displayName || msg.sender.pushName || msg.sender.phoneNumber?.split('@')[0]
        }
        if (!name) name = msg.chatJid.split('@')[0]

        return {
            type: 'message' as const,
            jid: msg.chatJid,
            name,
            messageId: msg.id,
            snippet: msg.textContent || '',
            timestamp: msg.timestamp?.toString()
        }
    })
  }

  private async deepSearch(
    q: string,
    _sock: any,
    filters?: SearchFilters
  ): Promise<SearchResultItem[]> {
    const queryVector = await embeddingService.embed(q)
    const queryVectorJson = JSON.stringify(queryVector)

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

      if (ids.length < 2000) {
        filterSql = `AND messageId IN (${ids.map(() => '?').join(',')})`
        params.push(...ids)
      }
    }

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

      const scoredIds = scoredResults.map((r) => r.messageId)
      const messages = await prisma.message.findMany({
        where: { id: { in: scoredIds } },
        include: { chat: true, sender: true }
      })

      const msgMap = new Map(messages.map((m: any) => [m.id, m]))

      return scoredResults
        .map((res) => {
          const msg = msgMap.get(res.messageId)
          if (!msg) return null
          
          let name = msg.chat?.name
          if (!name && msg.chat?.type === 'DM' && msg.sender) {
              name = msg.sender.displayName || msg.sender.pushName || msg.sender.phoneNumber?.split('@')[0]
          }
          if (!name) name = msg.chatJid.split('@')[0]

          return {
            type: 'message' as const,
            jid: msg.chatJid,
            name,
            messageId: msg.id,
            snippet: msg.textContent || '',
            timestamp: msg.timestamp?.toString(),
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
