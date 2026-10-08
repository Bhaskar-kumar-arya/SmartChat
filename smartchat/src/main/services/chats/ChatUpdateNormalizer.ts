import { ChatUpdatePayload } from '../../domain/whatsapp.types'
import { parseBaileysTimestamp, normalizeMuteExpirationSeconds } from '../../utils/messageUtils'
import { parseCommunityMetadata } from '../../utils/communityUtils'
import { ChatUpsertData } from './IChatRepository'

/**
 * Which writer produced the raw payload. The three sources deliver differently-shaped data and
 * historically each mapped it to Chat columns slightly differently; those differences are kept
 * per source here (pinned by ChatUpdateWriters.characterization.test.ts) until the owner decides
 * which semantics win.
 *  - live:        chats.upsert / chats.update (ChatService.upsertChat)
 *  - historySync: history-sync chat entries (SyncChatsHandler)
 *  - groupSync:   full group hydration metadata (ChatSyncHandler, CommunitySyncHandler)
 */
export type ChatUpdateSource = 'live' | 'historySync' | 'groupSync'

export type ChatUpdateInput = Omit<ChatUpdatePayload, 'id'> & { isArchived?: boolean | null }

export interface ChatCommunityInfo {
  type: string
  isCommunity: boolean
  isAnnounce: boolean
  rootJid: string | null
}

export interface NormalizedChatUpdate {
  /** Only the columns this source wants to overwrite; `communityId` is resolved by the caller. */
  data: ChatUpsertData
  /** Present iff the payload carried any community field (then `data.type` is set too). */
  community: ChatCommunityInfo | null
}

interface SourcePolicy {
  /** undefined = leave the column alone. */
  name(raw: ChatUpdateInput): string | null | undefined
  timestamp(raw: ChatUpdateInput): bigint | undefined
  archived(raw: ChatUpdateInput): boolean | undefined
  unreadCount(raw: ChatUpdateInput): number | undefined
  pinned(raw: ChatUpdateInput): number | undefined
  muteExpiration(raw: ChatUpdateInput): bigint | undefined
  profilePictureUrl(raw: ChatUpdateInput): string | null | undefined
  /**
   * SUSPECT (owner decision pending): historySync does not treat a bare `isAnnounce` as an
   * announce-channel flag, the other two sources do.
   */
  bareIsAnnounceClassifiesAnnounce: boolean
}

const rawTimestamp = (raw: ChatUpdateInput): unknown => raw.conversationTimestamp ?? raw.timestamp

const archivedIfPresent = (raw: ChatUpdateInput): boolean | undefined =>
  'archived' in raw || 'isArchived' in raw ? raw.archived === true || raw.isArchived === true : undefined

const anyUnreadNumber = (raw: ChatUpdateInput): number | undefined =>
  typeof raw.unreadCount === 'number' ? raw.unreadCount : undefined

const normalizedMuteIfDefined = (raw: ChatUpdateInput): bigint | undefined =>
  raw.muteExpiration !== undefined ? normalizeMuteExpirationSeconds(raw.muteExpiration) : undefined

const POLICIES: Record<ChatUpdateSource, SourcePolicy> = {
  live: {
    name: (raw) => raw.name || raw.subject,
    timestamp: (raw) => {
      const ts = rawTimestamp(raw)
      if (!ts) return undefined
      // Long-like values contribute only their low word (historical behaviour).
      return BigInt(
        typeof ts === 'object' && 'low' in ts
          ? (ts as { low: number }).low
          : (ts as number | bigint)
      )
    },
    archived: (raw) => (raw.archived !== undefined ? raw.archived === true : undefined),
    // WhatsApp uses -1 for "unknown"; only that is ignored.
    unreadCount: (raw) =>
      typeof raw.unreadCount === 'number' && raw.unreadCount >= 0 ? raw.unreadCount : undefined,
    pinned: (raw) =>
      raw.pinned !== undefined ? (raw.pinned === null ? 0 : Number(raw.pinned)) : undefined,
    muteExpiration: normalizedMuteIfDefined,
    profilePictureUrl: (raw) => raw.profilePictureUrl,
    bareIsAnnounceClassifiesAnnounce: true
  },
  historySync: {
    name: (raw) => raw.name,
    timestamp: (raw) => {
      const ts = rawTimestamp(raw)
      const parsed = ts !== undefined && ts !== null ? parseBaileysTimestamp(ts) : 0n
      return parsed !== 0n ? parsed : undefined
    },
    archived: archivedIfPresent,
    unreadCount: anyUnreadNumber,
    pinned: () => undefined,
    muteExpiration: (raw) => {
      const rawMute = raw.muteExpiration !== undefined ? raw.muteExpiration : raw.muteEndTime
      return rawMute !== undefined && rawMute !== null
        ? normalizeMuteExpirationSeconds(parseBaileysTimestamp(rawMute))
        : undefined
    },
    profilePictureUrl: () => undefined,
    bareIsAnnounceClassifiesAnnounce: false
  },
  groupSync: {
    name: (raw) => raw.name || raw.subject || undefined,
    timestamp: (raw) => {
      const ts = rawTimestamp(raw)
      return ts !== undefined && ts !== null ? parseBaileysTimestamp(ts) : undefined
    },
    archived: archivedIfPresent,
    unreadCount: anyUnreadNumber,
    pinned: (raw) => (typeof raw.pinned === 'number' ? raw.pinned : undefined),
    muteExpiration: normalizedMuteIfDefined,
    profilePictureUrl: (raw) =>
      raw.profilePictureUrl !== undefined ? raw.profilePictureUrl || null : undefined,
    bareIsAnnounceClassifiesAnnounce: true
  }
}

/** Community/announce classification of a payload, or null if it carries no community field. */
export function classifyCommunity(
  jid: string,
  raw: ChatUpdateInput,
  source: ChatUpdateSource
): ChatCommunityInfo | null {
  const full = parseCommunityMetadata(jid, raw)
  if (!full.hasCommunityData) return null
  const info =
    !POLICIES[source].bareIsAnnounceClassifiesAnnounce && raw.isAnnounce
      ? parseCommunityMetadata(jid, { ...raw, isAnnounce: undefined })
      : full
  return {
    type: info.type,
    isCommunity: info.isCommunity,
    isAnnounce: info.isAnnounce,
    rootJid: info.rootJid
  }
}

/**
 * Maps one raw chat payload to the Chat columns that source overwrites. Pure: no I/O. Callers
 * resolve `communityId` from `community.rootJid` with their own repositories.
 */
export function normalizeChatUpdate(
  jid: string,
  raw: ChatUpdateInput,
  source: ChatUpdateSource
): NormalizedChatUpdate {
  const policy = POLICIES[source]
  const data: ChatUpsertData = {}
  const assign = <K extends keyof ChatUpsertData>(key: K, value: ChatUpsertData[K]): void => {
    if (value !== undefined) data[key] = value
  }
  assign('unreadCount', policy.unreadCount(raw))
  assign('pinned', policy.pinned(raw))
  assign('muteExpiration', policy.muteExpiration(raw))
  assign('isArchived', policy.archived(raw))
  assign('name', policy.name(raw))
  assign('profilePictureUrl', policy.profilePictureUrl(raw))
  assign('timestamp', policy.timestamp(raw))

  const community = classifyCommunity(jid, raw, source)
  if (community) data.type = community.type
  return { data, community }
}
