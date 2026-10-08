import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import type { PrismaClient } from '@prisma/client'
import { WAEventBus } from '../../services/whatsapp/WAEventBus'
import { WAEventHandler } from '../../services/whatsapp/WAEventHandler'
import type { ServiceContainer } from '../../ServiceContainer'
import {
  getPrismaClient,
  clearDatabase,
  createMockSocket,
  createTestServiceContainer,
  injectEvent
} from '../helpers'

/**
 * F-MSG-4: history-sync reactions whose target message is stored by a LATER chunk
 * (B-MSG-01), and ephemeralMessage-wrapped inline reactions. Drives the real
 * WorkerHistorySyncManager -> SyncMessagesHandler -> ReactionRepository against
 * the real test DB.
 */

const CHAT = '5511111111111@s.whatsapp.net'
const ALICE = '5522222222222@s.whatsapp.net'
const SYNC_TYPE_RECENT = 3

function textMsg(id: string, ts: number): Record<string, unknown> {
  return {
    key: { id, remoteJid: CHAT, fromMe: false, participant: ALICE },
    message: { conversation: `text ${id}` },
    messageTimestamp: ts
  }
}

function reactionMsg(id: string, targetId: string, emoji: string, ts: number, wrapped = false): Record<string, unknown> {
  const reactionMessage = { key: { id: targetId, remoteJid: CHAT, fromMe: false }, text: emoji }
  return {
    key: { id, remoteJid: CHAT, fromMe: false, participant: ALICE },
    message: wrapped ? { ephemeralMessage: { message: { reactionMessage } } } : { reactionMessage },
    messageTimestamp: ts
  }
}

function chunk(messages: Array<Record<string, unknown>>, progress = 10): Record<string, unknown> {
  return { chats: [], contacts: [], messages, syncType: SYNC_TYPE_RECENT, progress, isLatest: false }
}

describe('deferred reactions in history sync (real DB)', () => {
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
    eventHandler = new WAEventHandler(
      services.messageProcessingService,
      services.messageParserService,
      services.contactService,
      services.messageQueryService,
      bus,
      () => Promise.resolve(false)
    )
    sock = createMockSocket()
    await services.contactService.registerMe({ id: sock.user.id, name: sock.user.name, lid: sock.user.lid })
  })

  afterEach(async () => {
    await prisma.$disconnect()
    bus.removeAllListeners()
  })

  async function reactionsOn(messageId: string): Promise<Array<{ text: string }>> {
    return prisma.reaction.findMany({ where: { messageId }, select: { text: true } })
  }

  it.fails('B-MSG-01: a reaction whose target is stored by a later chunk is applied once the target exists', async () => {
    await injectEvent('messaging-history.set', chunk([reactionMsg('r1', 'T1', '🔥', 2000)]), services, eventHandler, sock)
    expect(await prisma.reaction.count()).toBe(0)

    await injectEvent('messaging-history.set', chunk([textMsg('T1', 1000)]), services, eventHandler, sock)

    expect(await reactionsOn('T1')).toEqual([{ text: '🔥' }])
  })

  it('a deferred reaction does not clobber a newer reaction stored for the same reactor', async () => {
    await injectEvent('messaging-history.set', chunk([reactionMsg('r1', 'T1', '🔥', 2000)]), services, eventHandler, sock)
    await injectEvent(
      'messaging-history.set',
      chunk([textMsg('T1', 1000), reactionMsg('r2', 'T1', '🥶', 3000)]),
      services,
      eventHandler,
      sock
    )

    expect(await reactionsOn('T1')).toEqual([{ text: '🥶' }])
  })

  it('a reaction whose target never arrives is dropped quietly when sync finishes', async () => {
    await injectEvent('messaging-history.set', chunk([reactionMsg('r1', 'GHOST', '🔥', 2000)]), services, eventHandler, sock)
    await injectEvent(
      'messaging-history.set',
      chunk([textMsg('T1', 1000)], 100),
      services,
      eventHandler,
      sock
    )

    expect(await prisma.reaction.count()).toBe(0)
    expect(await prisma.message.findUnique({ where: { id: 'T1' } })).not.toBeNull()
  })

  it('an ephemeralMessage-wrapped inline reaction is extracted', async () => {
    await injectEvent(
      'messaging-history.set',
      chunk([textMsg('T1', 1000), reactionMsg('r1', 'T1', '🔥', 2000, true)]),
      services,
      eventHandler,
      sock
    )

    expect(await reactionsOn('T1')).toEqual([{ text: '🔥' }])
  })
})
