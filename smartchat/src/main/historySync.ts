import { PrismaClient, Message } from '@prisma/client'
import { ContactService } from './services/contacts/ContactService'
import { SyncContactsHandler } from './services/sync/SyncContactsHandler'
import { SyncChatsHandler } from './services/sync/SyncChatsHandler'
import { SyncMessagesHandler } from './services/sync/SyncMessagesHandler'

export interface HistorySyncData {
  chats: Array<Record<string, unknown>>
  contacts: Array<Record<string, unknown>>
  messages: Array<Record<string, unknown>>
  lidPnMappings?: Array<{ lid: string; pn: string }>
  phoneNumberToLidMappings?: Array<{ lidJid: string; pnJid: string }>
  syncType: unknown
  isLatest: boolean
  progress: number
}

export interface HistorySyncResult {
  progress: number
  isLatest: boolean
  contactCount: number
  chatCount: number
  messageCount: number
  importedMessages: Message[]
}

/**
 * handleHistorySync — Thin orchestrator for the history sync pipeline.
 *
 * Delegates all domain logic to single-responsibility handlers:
 *  - SyncContactsHandler: LID↔PN mappings + contact upserts
 *  - SyncChatsHandler:    chat type classification, community metadata, mute settings
 *  - SyncMessagesHandler: batch message parsing, reactions, DB persistence
 */
export async function handleHistorySync(
  data: HistorySyncData,
  prisma: PrismaClient,
  contactService: ContactService
): Promise<HistorySyncResult> {
  const meJids = await contactService.getMeJids()
  const meJid = meJids[0] ?? null
  const meIdentityId = meJid ? await contactService.getIdentityIdByJid(meJid) : null

  const { chats, contacts, messages, lidPnMappings, phoneNumberToLidMappings, progress, isLatest } = data

  // Clear in-memory JID caches for a fresh sync chunk
  contactService.clearCaches()

  // Pre-fetch known chat JIDs so handlers can skip redundant chat creation
  const existingChats = await prisma.chat.findMany({ select: { jid: true } })
  const processedChats = new Set<string>(existingChats.map(ch => ch.jid))

  // ── 1. Contacts & LID↔PN mappings ─────────────────────────────────────────
  const contactsHandler = new SyncContactsHandler(contactService)
  await contactsHandler.processLidPnMappings(lidPnMappings, phoneNumberToLidMappings)
  const contactCount = await contactsHandler.processContacts(
    contacts as Array<Record<string, unknown>>
  )

  // ── 2. Chats ────────────────────────────────────────────────────────────────
  const chatsHandler = new SyncChatsHandler(prisma, contactService)
  const chatCount = await chatsHandler.processChats(
    chats as Array<Record<string, unknown>>,
    processedChats
  )

  // ── 3. Messages & Reactions ─────────────────────────────────────────────────
  const messagesHandler = new SyncMessagesHandler(prisma, contactService)
  const { messageCount, importedMessages } = await messagesHandler.processMessages(
    messages,
    processedChats,
    meJid,
    meIdentityId
  )

  console.log(
    `[HistorySync] progress=${progress}% | contacts=${contactCount} chats=${chatCount} messages=${messageCount} | isLatest=${isLatest}`
  )

  return { progress, isLatest, contactCount, chatCount, messageCount, importedMessages }
}