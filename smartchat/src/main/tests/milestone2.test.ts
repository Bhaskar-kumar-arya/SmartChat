import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { readFileSync } from 'fs'
import { join } from 'path'
import { PrismaClient } from '@prisma/client'
import { WAEventBus } from '../services/whatsapp/WAEventBus'
import { WAEventHandler } from '../services/whatsapp/WAEventHandler'
import { ServiceContainer } from '../ServiceContainer'
import {
  getPrismaClient,
  clearDatabase,
  createMockSocket,
  createTestServiceContainer,
  injectEvent
} from './helpers'

// ── Fixture Loading ─────────────────────────────────────────────────────────

const fixturePath = join(__dirname, '../../../dev_only/logs/wa_events_test_fixture.json')
const fixtureEvents: Array<{ event: string; payload: any }> = JSON.parse(
  readFileSync(fixturePath, 'utf8')
)

/**
 * Finds and slices the history-sync fixture to a fast, fixed size.
 * Extracted here so each test suite can reuse it without reimplementing the search.
 */
function getHistorySyncPayload(opts = { chats: 20, contacts: 20, messages: 50 }) {
  const syncEvent = fixtureEvents.find(
    (e) => e.event === 'messaging-history.set' && e.payload.messages?.length > 0
  )
  if (!syncEvent) throw new Error('messaging-history.set fixture not found')
  return {
    ...syncEvent.payload,
    chats:    syncEvent.payload.chats.slice(0, opts.chats),
    contacts: syncEvent.payload.contacts.slice(0, opts.contacts),
    messages: syncEvent.payload.messages.slice(0, opts.messages)
  }
}

// ── Shared Test Environment ─────────────────────────────────────────────────

describe('Milestone 2 Integration Tests', () => {
  let prisma: PrismaClient
  let bus: WAEventBus
  let services: ServiceContainer
  let eventHandler: WAEventHandler
  let sock: ReturnType<typeof createMockSocket>

  beforeEach(async () => {
    vi.clearAllMocks()

    prisma = getPrismaClient()
    await clearDatabase(prisma)

    bus = new WAEventBus()
    services = createTestServiceContainer(prisma, bus)
    eventHandler = new WAEventHandler(services, bus)
    sock = createMockSocket()

    await services.contactService.registerMe({
      id: sock.user.id,
      name: sock.user.name,
      lid: sock.user.lid
    })
  })

  afterEach(async () => {
    await prisma.$disconnect()
    bus.removeAllListeners()
  })

  // ── Journey 1: History Sync ───────────────────────────────────────────────

  describe('Backlog Synchronization (History Sync)', () => {
    it('should create a Chat row for every JID in the history sync payload', async () => {
      const payload = getHistorySyncPayload()
      await injectEvent('messaging-history.set', payload, services, eventHandler, sock)

      for (const expectedChat of payload.chats) {
        const chat = await prisma.chat.findUnique({ where: { jid: expectedChat.id } })
        expect(chat, `Chat ${expectedChat.id} missing from DB`).not.toBeNull()
        expect(chat?.jid).toBe(expectedChat.id)
      }
    }, 30000)

    it('should create at least one Identity and IdentityAlias from history sync contacts', async () => {
      const payload = getHistorySyncPayload()
      await injectEvent('messaging-history.set', payload, services, eventHandler, sock)

      const identityCount = await prisma.identity.count()
      const aliasCount    = await prisma.identityAlias.count()
      expect(identityCount).toBeGreaterThan(0)
      expect(aliasCount).toBeGreaterThan(0)
    }, 30000)

    it('should bulk-insert messages and link each one to its parent Chat', async () => {
      const payload = getHistorySyncPayload()
      await injectEvent('messaging-history.set', payload, services, eventHandler, sock)

      const messageCount = await prisma.message.count()
      expect(messageCount).toBeGreaterThan(0)

      // Every message with text content must have a non-null chatJid
      const orphaned = await prisma.message.findFirst({
        where: { textContent: { not: null }, chatJid: '' }
      })
      expect(orphaned).toBeNull()
    }, 30000)
  })

  // ── Journey 2a: Real-time Message (notify) ───────────────────────────────

  describe('Real-time Message Upsert — notify type', () => {
    const chatJid       = '919999999999@s.whatsapp.net'
    const messageId     = 'TEST_MSG_ID_NOTIFY'
    const textContent   = 'Hello, this is a real-time test message!'
    const senderJid     = '919999999999@s.whatsapp.net'
    let   timestampSeconds: number

    beforeEach(async () => {
      timestampSeconds = Math.floor(Date.now() / 1000)
      await injectEvent('messages.upsert', {
        type: 'notify',
        messages: [{
          key: { remoteJid: chatJid, fromMe: false, id: messageId, participant: senderJid },
          message: { conversation: textContent },
          messageTimestamp: timestampSeconds,
          pushName: 'Test Contact'
        }]
      }, services, eventHandler, sock)
    })

    it('should persist the message with correct text, type, and raw content', async () => {
      const msg = await prisma.message.findUnique({ where: { id: messageId } })
      expect(msg).not.toBeNull()
      expect(msg?.textContent).toBe(textContent)
      expect(msg?.messageType).toBe('conversation')
      expect(msg?.chatJid).toBe(chatJid)
      expect(msg?.fromMe).toBe(false)
      const parsed = JSON.parse(msg?.content || '{}')
      expect(parsed.conversation).toBe(textContent)
    })

    it('should upsert the sender Identity with correct attributes and link their Alias', async () => {
      const identity = await prisma.identity.findFirst({ where: { pushName: 'Test Contact' } })
      expect(identity).not.toBeNull()
      expect(identity?.isMe).toBe(false)

      const alias = await prisma.identityAlias.findUnique({ where: { jid: senderJid } })
      expect(alias).not.toBeNull()
      expect(alias?.identityId).toBe(identity?.id)
    })

    it('should increment the chat unreadCount and update its timestamp', async () => {
      const chat = await prisma.chat.findUnique({ where: { jid: chatJid } })
      expect(chat).not.toBeNull()
      expect(chat?.unreadCount).toBe(1)
      expect(Number(chat?.timestamp)).toBe(timestampSeconds)
    })

    it('should trigger the semantic indexer for real-time messages', () => {
      expect(services.embeddingService.indexMessage).toHaveBeenCalledWith(messageId, textContent)
    })
  })

  // ── Journey 2b: Backlog Catch-up (append) ────────────────────────────────

  describe('Backlog Catch-up — append type', () => {
    const chatJid      = '919888888888@s.whatsapp.net'
    const messageId1   = 'APPEND_MSG_ID_1'
    const messageId2   = 'APPEND_MSG_ID_2'
    const textContent1 = 'First appended message!'
    const textContent2 = 'Second appended message!'
    const senderJid    = '919888888888@s.whatsapp.net'
    let   timestampSeconds: number

    beforeEach(async () => {
      timestampSeconds = Math.floor(Date.now() / 1000)
      await injectEvent('messages.upsert', {
        type: 'append',
        messages: [
          {
            key: { remoteJid: chatJid, fromMe: false, id: messageId1, participant: senderJid },
            message: { conversation: textContent1 },
            messageTimestamp: timestampSeconds,
            pushName: 'Append Contact'
          },
          {
            key: { remoteJid: chatJid, fromMe: false, id: messageId2, participant: senderJid },
            message: { conversation: textContent2 },
            messageTimestamp: timestampSeconds + 10,
            pushName: 'Append Contact'
          }
        ]
      }, services, eventHandler, sock)
    })

    it('should bulk-persist both messages with correct text and type', async () => {
      const msg1 = await prisma.message.findUnique({ where: { id: messageId1 } })
      const msg2 = await prisma.message.findUnique({ where: { id: messageId2 } })
      expect(msg1?.textContent).toBe(textContent1)
      expect(msg1?.messageType).toBe('conversation')
      expect(msg2?.textContent).toBe(textContent2)
      expect(msg2?.messageType).toBe('conversation')
    })

    it('should auto-create the parent Chat with a default timestamp of 0', async () => {
      const chat = await prisma.chat.findUnique({ where: { jid: chatJid } })
      expect(chat).not.toBeNull()
      // Timestamp stays 0 until a chats.upsert/update event arrives (separate flow)
      expect(Number(chat?.timestamp)).toBe(0)
    })

    it('should NOT increment unreadCount for catch-up messages', async () => {
      const chat = await prisma.chat.findUnique({ where: { jid: chatJid } })
      expect(chat?.unreadCount).toBe(0)
    })

    it('should NOT trigger the synchronous semantic indexer during bulk catch-up', () => {
      expect(services.embeddingService.indexMessage).not.toHaveBeenCalledWith(messageId1, textContent1)
      expect(services.embeddingService.indexMessage).not.toHaveBeenCalledWith(messageId2, textContent2)
    })
  })

  // ── Journey 2c: Chat List Timestamp Population ───────────────────────────

  describe('Chat Metadata and Timestamp Updates (chats.upsert / chats.update)', () => {
    const chatJid = '917777777777@s.whatsapp.net'

    it('should populate chat metadata from a chats.upsert event', async () => {
      const ts = Math.floor(Date.now() / 1000)
      await injectEvent('chats.upsert', [{
        id: chatJid, name: 'Support Chat', unreadCount: 5, pinned: true, conversationTimestamp: ts
      }], services, eventHandler, sock)

      const chat = await prisma.chat.findUnique({ where: { jid: chatJid } })
      expect(chat?.name).toBe('Support Chat')
      expect(chat?.unreadCount).toBe(5)
      expect(chat?.pinned).toBe(1)
      expect(Number(chat?.timestamp)).toBe(ts)
    })

    it('should update only changed fields from a chats.update event without overwriting others', async () => {
      const ts = Math.floor(Date.now() / 1000)
      // Seed the chat first
      await injectEvent('chats.upsert', [{
        id: chatJid, name: 'Support Chat', unreadCount: 5, pinned: true, conversationTimestamp: ts
      }], services, eventHandler, sock)

      const newTs = ts + 3600
      await injectEvent('chats.update', [{
        id: chatJid, archived: true, conversationTimestamp: newTs
      }], services, eventHandler, sock)

      const chat = await prisma.chat.findUnique({ where: { jid: chatJid } })
      expect(chat?.isArchived).toBe(true)
      expect(Number(chat?.timestamp)).toBe(newTs)
      // Fields not in the update payload must remain unchanged
      expect(chat?.pinned).toBe(1)
      expect(chat?.name).toBe('Support Chat')
    })
  })
})
