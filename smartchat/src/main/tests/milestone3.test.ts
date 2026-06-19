import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
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

describe('Milestone 3 Integration Tests', () => {
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
    eventHandler = new WAEventHandler(services.messageService, bus)
    sock = createMockSocket()

    await services.contactService.registerMe({
      id: sock.user.id,
      name: sock.user.name,
      lid: sock.user.lid
    })
  })

  afterEach(async () => {
    await prisma.$disconnect()
    if (bus) {
      bus.removeAllListeners()
    }
  })

  // ── Journey 3: Message Deletes (Revokes) and Edits ──────────────────────────

  describe('Message Revokes and Edits', () => {
    const chatJid = '919999999999@s.whatsapp.net'
    const senderJid = '919999999999@s.whatsapp.net'

    it('should revoke an existing message via messages.update (isDeleted = true)', async () => {
      const messageId = 'MSG_TO_REVOKE'
      const ts = Math.floor(Date.now() / 1000)

      // 1. Seed the message first
      await injectEvent('messages.upsert', {
        type: 'notify',
        messages: [{
          key: { remoteJid: chatJid, fromMe: false, id: messageId, participant: senderJid },
          message: { conversation: 'Original message content' },
          messageTimestamp: ts,
          pushName: 'Test Sender'
        }]
      }, services, eventHandler, sock)

      // Verify message is not deleted
      let msg = await prisma.message.findUnique({ where: { id: messageId } })
      expect(msg).not.toBeNull()
      expect(msg?.isDeleted).toBe(false)

      // 2. Inject revoke protocol update
      await injectEvent('messages.update', [
        {
          key: { remoteJid: chatJid },
          update: {
            protocolMessage: {
              key: {
                remoteJid: chatJid,
                fromMe: false,
                id: messageId
              },
              type: 'REVOKE'
            }
          }
        }
      ], services, eventHandler, sock)

      // 3. Verify target message has isDeleted = true
      msg = await prisma.message.findUnique({ where: { id: messageId } })
      expect(msg?.isDeleted).toBe(true)
    })

    it('should revoke an existing message via messages.upsert with protocolMessage', async () => {
      const messageId = 'MSG_TO_REVOKE_UPSERT'
      const ts = Math.floor(Date.now() / 1000)

      // 1. Seed the message first
      await injectEvent('messages.upsert', {
        type: 'notify',
        messages: [{
          key: { remoteJid: chatJid, fromMe: false, id: messageId, participant: senderJid },
          message: { conversation: 'Another original message' },
          messageTimestamp: ts,
          pushName: 'Test Sender'
        }]
      }, services, eventHandler, sock)

      // 2. Inject upsert with revoke protocolMessage
      await injectEvent('messages.upsert', {
        type: 'notify',
        messages: [{
          key: { remoteJid: chatJid, fromMe: false, id: 'REVOKE_PROTOCOL_ID' },
          message: {
            protocolMessage: {
              key: {
                remoteJid: chatJid,
                fromMe: false,
                id: messageId
              },
              type: 'REVOKE'
            }
          },
          messageTimestamp: ts + 1
        }]
      }, services, eventHandler, sock)

      // 3. Verify target message has isDeleted = true
      const msg = await prisma.message.findUnique({ where: { id: messageId } })
      expect(msg?.isDeleted).toBe(true)
    })

    it('should edit an existing message via messages.update (isEdited = true, textContent updated)', async () => {
      const messageId = 'MSG_TO_EDIT'
      const ts = Math.floor(Date.now() / 1000)

      // 1. Seed the message first
      await injectEvent('messages.upsert', {
        type: 'notify',
        messages: [{
          key: { remoteJid: chatJid, fromMe: false, id: messageId, participant: senderJid },
          message: { conversation: 'Original content' },
          messageTimestamp: ts,
          pushName: 'Test Sender'
        }]
      }, services, eventHandler, sock)

      // 2. Inject edit protocol update
      await injectEvent('messages.update', [
        {
          key: { remoteJid: chatJid },
          update: {
            protocolMessage: {
              key: {
                remoteJid: chatJid,
                fromMe: false,
                id: messageId
              },
              type: 'MESSAGE_EDIT',
              editedMessage: {
                conversation: 'This is edited text!'
              }
            }
          }
        }
      ], services, eventHandler, sock)

      // 3. Verify target message isEdited = true and content is updated
      const msg = await prisma.message.findUnique({ where: { id: messageId } })
      expect(msg?.isEdited).toBe(true)
      expect(msg?.textContent).toBe('This is edited text!')
      
      const contentObj = JSON.parse(msg?.content || '{}')
      expect(contentObj.conversation).toBe('This is edited text!')
    })

    it('should edit an existing message via messages.upsert with protocolMessage', async () => {
      const messageId = 'MSG_TO_EDIT_UPSERT'
      const ts = Math.floor(Date.now() / 1000)

      // 1. Seed the message first
      await injectEvent('messages.upsert', {
        type: 'notify',
        messages: [{
          key: { remoteJid: chatJid, fromMe: false, id: messageId, participant: senderJid },
          message: { conversation: 'Original content' },
          messageTimestamp: ts,
          pushName: 'Test Sender'
        }]
      }, services, eventHandler, sock)

      // 2. Inject upsert with edit protocolMessage
      await injectEvent('messages.upsert', {
        type: 'notify',
        messages: [{
          key: { remoteJid: chatJid, fromMe: false, id: 'EDIT_PROTOCOL_ID' },
          message: {
            protocolMessage: {
              key: {
                remoteJid: chatJid,
                fromMe: false,
                id: messageId
              },
              type: 'MESSAGE_EDIT',
              editedMessage: {
                conversation: 'Edited via upsert!'
              }
            }
          },
          messageTimestamp: ts + 1
        }]
      }, services, eventHandler, sock)

      // 3. Verify target message has updated content
      const msg = await prisma.message.findUnique({ where: { id: messageId } })
      expect(msg?.isEdited).toBe(true)
      expect(msg?.textContent).toBe('Edited via upsert!')
    })
  })

  // ── Journey 4: Reactions Handling ──────────────────────────────────────────

  describe('Reactions Handling', () => {
    const chatJid = '919999999999@s.whatsapp.net'
    const senderJid = '919999999999@s.whatsapp.net'
    const messageId = 'REACTION_TARGET_MSG'
    let senderId: number

    beforeEach(async () => {
      const ts = Math.floor(Date.now() / 1000)
      // Seed message and contact first
      await injectEvent('messages.upsert', {
        type: 'notify',
        messages: [{
          key: { remoteJid: chatJid, fromMe: false, id: messageId, participant: senderJid },
          message: { conversation: 'React to this!' },
          messageTimestamp: ts,
          pushName: 'Reactor Contact'
        }]
      }, services, eventHandler, sock)

      const resolvedId = await services.contactService.getIdentityIdByJid(senderJid)
      if (!resolvedId) throw new Error('Reactor identity not resolved')
      senderId = resolvedId
    })

    it('should add a reaction to a message', async () => {
      const ts = Math.floor(Date.now() / 1000)

      await injectEvent('messages.reaction', [
        {
          key: { remoteJid: chatJid, fromMe: false, id: messageId },
          reaction: {
            key: { remoteJid: chatJid, fromMe: false, id: messageId, participant: senderJid },
            text: '💖',
            senderTimestampMs: ts * 1000
          }
        }
      ], services, eventHandler, sock)

      const reaction = await prisma.reaction.findUnique({
        where: { messageId_senderId: { messageId, senderId } }
      })
      expect(reaction).not.toBeNull()
      expect(reaction?.text).toBe('💖')
      expect(Number(reaction?.timestamp)).toBe(ts)
    })

    it('should update an existing reaction on a message', async () => {
      const ts = Math.floor(Date.now() / 1000)

      // Add reaction
      await injectEvent('messages.reaction', [
        {
          key: { remoteJid: chatJid, fromMe: false, id: messageId },
          reaction: {
            key: { remoteJid: chatJid, fromMe: false, id: messageId, participant: senderJid },
            text: '💖',
            senderTimestampMs: ts * 1000
          }
        }
      ], services, eventHandler, sock)

      // Update reaction
      await injectEvent('messages.reaction', [
        {
          key: { remoteJid: chatJid, fromMe: false, id: messageId },
          reaction: {
            key: { remoteJid: chatJid, fromMe: false, id: messageId, participant: senderJid },
            text: '👍',
            senderTimestampMs: (ts + 5) * 1000
          }
        }
      ], services, eventHandler, sock)

      const reaction = await prisma.reaction.findUnique({
        where: { messageId_senderId: { messageId, senderId } }
      })
      expect(reaction?.text).toBe('👍')
      expect(Number(reaction?.timestamp)).toBe(ts + 5)
    })

    it('should delete a reaction when receiving an empty text/emoji', async () => {
      const ts = Math.floor(Date.now() / 1000)

      // Add reaction
      await injectEvent('messages.reaction', [
        {
          key: { remoteJid: chatJid, fromMe: false, id: messageId },
          reaction: {
            key: { remoteJid: chatJid, fromMe: false, id: messageId, participant: senderJid },
            text: '💖',
            senderTimestampMs: ts * 1000
          }
        }
      ], services, eventHandler, sock)

      // Verify reaction is present
      let reaction = await prisma.reaction.findUnique({
        where: { messageId_senderId: { messageId, senderId } }
      })
      expect(reaction).not.toBeNull()

      // Delete reaction (sending empty string)
      await injectEvent('messages.reaction', [
        {
          key: { remoteJid: chatJid, fromMe: false, id: messageId },
          reaction: {
            key: { remoteJid: chatJid, fromMe: false, id: messageId, participant: senderJid },
            text: '',
            senderTimestampMs: (ts + 10) * 1000
          }
        }
      ], services, eventHandler, sock)

      reaction = await prisma.reaction.findUnique({
        where: { messageId_senderId: { messageId, senderId } }
      })
      expect(reaction).toBeNull()
    })
  })

  // ── Journey 5: Identity Reconciliation (LID / PN Mapping) ──────────────────

  describe('Identity Reconciliation (LID / PN Mapping)', () => {
    const lid = '918888888888@lid'
    const pn = '918888888888@s.whatsapp.net'

    it('should link LID and PN via lid-mapping.update event', async () => {
      // 1. Inject LID to PN mapping
      await injectEvent('lid-mapping.update', { lid, pn }, services, eventHandler, sock)

      // 2. Verify mapping exists in LidMap ledger
      const mapEntry = await prisma.lidMap.findUnique({ where: { lid } })
      expect(mapEntry).not.toBeNull()
      expect(mapEntry?.pn).toBe(pn)

      // 3. Verify a single Identity row is created with PN
      const identity = await prisma.identity.findUnique({ where: { phoneNumber: pn } })
      expect(identity).not.toBeNull()

      // 4. Verify both aliases exist and point to the same Identity
      const pnAlias = await prisma.identityAlias.findUnique({ where: { jid: pn } })
      const lidAlias = await prisma.identityAlias.findUnique({ where: { jid: lid } })
      expect(pnAlias?.identityId).toBe(identity?.id)
      expect(lidAlias?.identityId).toBe(identity?.id)
    })

    it('should reconcile/merge stub LID identities with existing PN identities to prevent identity pollution', async () => {
      // 1. Simulate receiving contact details via LID only (stub created)
      await services.contactService.upsertContact({
        id: lid,
        name: 'LID User',
        pushName: 'LID User'
      })

      const initialLidAlias = await prisma.identityAlias.findUnique({ where: { jid: lid } })
      expect(initialLidAlias).not.toBeNull()
      const originalLidIdentityId = initialLidAlias!.identityId

      // 2. Separately, create contact with phone number (PN)
      await services.contactService.upsertContact({
        id: pn,
        name: 'Canonical PN Name'
      })

      const pnIdentity = await prisma.identity.findUnique({ where: { phoneNumber: pn } })
      expect(pnIdentity).not.toBeNull()
      // Initially, they are different identities because they weren't linked yet
      expect(pnIdentity!.id).not.toBe(originalLidIdentityId)

      // 3. Now link LID and PN via mapping update
      await injectEvent('lid-mapping.update', { lid, pn }, services, eventHandler, sock)

      // 4. Verify LID alias has been re-pointed to PN identity ID
      const reconciledLidAlias = await prisma.identityAlias.findUnique({ where: { jid: lid } })
      expect(reconciledLidAlias?.identityId).toBe(pnIdentity?.id)

      // 5. Verify the old orphaned LID-only stub Identity row has been deleted
      const oldStubIdentity = await prisma.identity.findUnique({ where: { id: originalLidIdentityId } })
      expect(oldStubIdentity).toBeNull()

      // 6. Verify total number of identities is correct (only 2: me and this contact)
      const count = await prisma.identity.count()
      expect(count).toBe(2) // 1 for me, 1 for the reconciled contact
    })

    it('should prioritize LIDs correctly when resolving LID from PN JID', async () => {
      // 1. Link LID and PN
      await injectEvent('lid-mapping.update', { lid, pn }, services, eventHandler, sock)

      // 2. Resolve LID from PN JID
      const resolvedLid = await services.contactService.resolveLidFromJid(pn)
      expect(resolvedLid).toBe(lid)

      // 3. Unmapped PN returns itself
      const unmapped = await services.contactService.resolveLidFromJid('917777777777@s.whatsapp.net')
      expect(unmapped).toBe('917777777777@s.whatsapp.net')
    })
  })
})
