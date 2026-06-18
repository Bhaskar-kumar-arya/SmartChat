import { ContactService } from '../contacts/ContactService'
import { EmbeddingService } from './EmbeddingService'
import { WASocket } from '../../types'
import { IChatRepository } from '../chats/IChatRepository'
import { IMessageQueryRepository } from '../messages/IMessageQueryRepository'
import { IContactRepository } from '../contacts/IContactRepository'

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
  searchAll(query: string, mode: SearchMode, sock: WASocket | null, filters?: SearchFilters): Promise<SearchResults>
  searchMentionContacts(query: string): Promise<any[]>
  searchMentionChats(query: string): Promise<any[]>
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
  constructor(
    private readonly chatRepository: IChatRepository,
    private readonly messageRepository: IMessageQueryRepository,
    private readonly contactRepository: IContactRepository,
    private readonly contactService: ContactService,
    private readonly embeddingService: EmbeddingService
  ) {}

  async searchAll(
    query: string,
    mode: SearchMode,
    sock: WASocket | null,
    filters?: SearchFilters
  ): Promise<SearchResults> {
    const q = query.trim()
    if (!q) return { chats: [], messages: [] }

    // ── 1. Search chats ────────────────────────────────────────────────────────
    const allChats = await this.chatRepository.findChats(filters?.jids)
    
    // We only need to resolve names for DMs that lack a name
    const jidsToResolve = allChats.filter(c => !c.name && c.type === 'DM').map(c => c.jid)
    const nameMap = await this.contactService.batchResolveNames(jidsToResolve, sock)

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
        const lastMsg = await this.messageRepository.findLastMessage(chat.jid)
        return {
          type: 'chat' as const,
          jid: chat.jid,
          name,
          lastMessage:
            lastMsg?.messageType === 'stickerMessage' ? 'Sticker' :
            lastMsg?.messageType === 'lottieStickerMessage' ? 'Sticker' :
            lastMsg?.messageType === 'imageMessage' ? 'Photo' :
            lastMsg?.messageType === 'videoMessage' ? 'Video' :
            lastMsg?.messageType === 'ptvMessage' ? 'Video' :
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
    _sock: WASocket | null,
    filters?: SearchFilters
  ): Promise<SearchResultItem[]> {
    const where = buildMessageWhereClause(filters, {
      textContent: { contains: q }
    })

    const messages = await this.messageRepository.findMessagesWithChatAndSender(where, 30)

    return messages.map((msg: any) => {
        let name = msg.chat?.name
        if (!name && msg.chat?.type === 'DM' && msg.sender) {
            name = ContactService.getDisplayName(msg.sender, msg.chatJid.split('@')[0])
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
    _sock: WASocket | null,
    filters?: SearchFilters
  ): Promise<SearchResultItem[]> {
    const queryVector = await this.embeddingService.embed(q)
    const queryVectorJson = JSON.stringify(queryVector)

    let candidateIds: string[] | undefined = undefined

    const hasFilters = !!(filters?.jids?.length || filters?.fromDate || filters?.toDate)
    if (hasFilters) {
      candidateIds = await this.messageRepository.findMessageIdsOnly(buildMessageWhereClause(filters))
      if (candidateIds.length === 0) return []
    }

    try {
      const scoredResults = await this.messageRepository.searchVectorMatch(queryVectorJson, candidateIds)
      if (scoredResults.length === 0) return []

      const scoredIds = scoredResults.map((r) => r.messageId)
      const messages = await this.messageRepository.findMessagesByIdsWithChatAndSender(scoredIds)

      const msgMap = new Map(messages.map((m: any) => [m.id, m]))

      return scoredResults
        .map((res) => {
          const msg = msgMap.get(res.messageId)
          if (!msg) return null
          
          let name = msg.chat?.name
          if (!name && msg.chat?.type === 'DM' && msg.sender) {
              name = ContactService.getDisplayName(msg.sender, msg.chatJid.split('@')[0])
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

  async searchMentionContacts(query: string): Promise<any[]> {
    const q = query.trim()
    if (!q) return []

    // 1. Search Identities (contacts/people)
    const identities = await this.contactRepository.searchIdentities(q, 20)

    // 2. Search Chats (group chats, DMs, communities, subgroups)
    const chats = await this.chatRepository.searchChats(q, 20)

    const seenJids = new Set<string>()
    const results: any[] = []

    // Process Identities first
    for (const ident of identities) {
      const lidAlias = ident.aliases.find((a) => a.type === 'LID')
      const pnAlias = ident.aliases.find((a) => a.type === 'PN')
      const bestJid = lidAlias?.jid || pnAlias?.jid || ident.phoneNumber || ident.aliases[0]?.jid

      if (!bestJid) continue

      const displayName = ContactService.getDisplayName(ident, bestJid.split('@')[0])
      seenJids.add(bestJid)

      results.push({
        jid: bestJid,
        name: displayName,
        pushName: ident.pushName,
        verifiedName: ident.verifiedName,
        phoneNumber: ident.phoneNumber,
        profilePictureUrl: ident.profilePictureUrl
      })
    }

    // Process Chats
    for (const chat of chats) {
      // Resolve LID JID for DM chats to keep it consistent and deduplicated
      let resolvedJid = chat.jid
      if (chat.type === 'DM') {
        resolvedJid = await this.contactService.resolveLidFromJid(chat.jid)
      }

      if (seenJids.has(resolvedJid)) continue
      seenJids.add(resolvedJid)

      let pushName: string | null = null
      let verifiedName: string | null = null
      let phoneNumber: string | null = null
      let name = chat.name

      if (chat.type === 'DM') {
        const identId = await this.contactService.getIdentityIdByJid(chat.jid)
        if (identId) {
          const ident = await this.contactService.findIdentityById(identId)
          if (ident) {
            if (!name) name = ContactService.getDisplayName(ident, chat.jid.split('@')[0])
            pushName = ident.pushName
            verifiedName = ident.verifiedName
            phoneNumber = ident.phoneNumber
          }
        }
      }
      if (!name) name = chat.jid.split('@')[0]

      results.push({
        jid: resolvedJid,
        name,
        pushName,
        verifiedName,
        phoneNumber,
        profilePictureUrl: chat.profilePictureUrl
      })
    }

    return results.slice(0, 20)
  }

  async searchMentionChats(query: string): Promise<any[]> {
    return this.searchMentionContacts(query)
  }
}
