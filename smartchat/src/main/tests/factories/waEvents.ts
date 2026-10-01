/**
 * Pure builders for Baileys event payloads, shaped for `injectEvent(...)` in ../helpers.
 * No DB access; they only build the data the WA event handlers receive.
 */

export interface MessageUpsertOptions {
  chatJid: string
  id: string
  text?: string
  fromMe?: boolean
  /** Sender JID inside groups (key.participant). */
  participant?: string
  pushName?: string
  /** Seconds. Defaults to now. */
  timestamp?: number
  type?: 'notify' | 'append'
}

interface MessageKey {
  remoteJid: string
  fromMe: boolean
  id: string
  participant?: string
}

export interface MessagesUpsertPayload {
  type: 'notify' | 'append'
  messages: Array<{
    key: MessageKey
    message: { conversation: string }
    messageTimestamp: number
    pushName?: string
  }>
}

export function buildMessagesUpsert(o: MessageUpsertOptions): MessagesUpsertPayload {
  return {
    type: o.type ?? 'notify',
    messages: [
      {
        key: {
          remoteJid: o.chatJid,
          fromMe: o.fromMe ?? false,
          id: o.id,
          ...(o.participant ? { participant: o.participant } : {})
        },
        message: { conversation: o.text ?? 'hello' },
        messageTimestamp: o.timestamp ?? Math.floor(Date.now() / 1000),
        ...(o.pushName ? { pushName: o.pushName } : {})
      }
    ]
  }
}

export interface ReactionEventOptions {
  chatJid: string
  messageId: string
  /** Reactor JID (reaction.key.participant). */
  senderJid: string
  /** Emoji; empty string removes the reaction. */
  text: string
  /** Seconds. Defaults to now. */
  timestamp?: number
  fromMe?: boolean
}

export interface ReactionEventPayload {
  key: MessageKey
  reaction: { key: MessageKey; text: string; senderTimestampMs: number }
}

export function buildMessagesReaction(o: ReactionEventOptions): ReactionEventPayload[] {
  const ts = o.timestamp ?? Math.floor(Date.now() / 1000)
  return [
    {
      key: { remoteJid: o.chatJid, fromMe: o.fromMe ?? false, id: o.messageId },
      reaction: {
        key: {
          remoteJid: o.chatJid,
          fromMe: o.fromMe ?? false,
          id: o.messageId,
          participant: o.senderJid
        },
        text: o.text,
        senderTimestampMs: ts * 1000
      }
    }
  ]
}

export function buildLidMappingUpdate(lid: string, pn: string): Array<{ lid: string; pn: string }> {
  return [{ lid, pn }]
}

export interface ChatsUpsertOptions {
  id: string
  name?: string
  unreadCount?: number
  pinned?: boolean
  /** Seconds. */
  conversationTimestamp?: number
}

export function buildChatsUpsert(...chats: ChatsUpsertOptions[]): ChatsUpsertOptions[] {
  return chats.map(c => ({ ...c }))
}

export interface GroupMetadataOptions {
  id: string
  subject?: string
  participants?: Array<{ id: string; phoneNumber?: string; admin?: 'admin' | 'superadmin' | null }>
}

export interface GroupMetadataPayload {
  id: string
  subject: string
  participants: Array<{ id: string; phoneNumber?: string; admin: 'admin' | 'superadmin' | null }>
}

/** Minimal Baileys GroupMetadata (id/subject/participants). */
export function buildGroupMetadata(o: GroupMetadataOptions): GroupMetadataPayload {
  return {
    id: o.id,
    subject: o.subject ?? 'Test Group',
    participants: (o.participants ?? []).map(p => ({ admin: null, ...p }))
  }
}
