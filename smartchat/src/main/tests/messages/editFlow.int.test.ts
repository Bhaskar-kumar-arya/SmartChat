import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from 'vitest'
import type { Message, PrismaClient } from '@prisma/client'
import type { BrowserWindow } from 'electron'
import { MessageRepository } from '../../services/messages/MessageRepository'
import { UIBroadcastSubscriber } from '../../services/whatsapp/subscribers/UIBroadcastSubscriber'
import type { IWAEventBus, AsyncHandler } from '../../services/whatsapp/IWAEventBus'
import type { IContactNameResolver } from '../../services/contacts/IContactService'
import type { IMessageQueryService } from '../../services/messages/IMessageQueryService'
import type { IMessageReadRepository } from '../../services/messages/IMessageQueryRepository'
import { getPrismaClient, resetDb } from '../helpers'
import { makeChat, makeMessage, pnJid } from '../factories'

/**
 * F-MSG-1 edit-flow characterization against the real test DB (B-MSG-03/04/06).
 * `it.fails` marks a bug that is still present; the fix commit flips them.
 */

const QUOTE = {
  stanzaId: 'orig_1',
  participant: 'alice@s.whatsapp.net',
  quotedMessage: { conversation: 'original question' }
}
const MCI = { deviceListMetadata: { senderKeyHash: 'abc' } }

function replyContent(text: string): string {
  return JSON.stringify({
    extendedTextMessage: { text, contextInfo: QUOTE },
    messageContextInfo: MCI
  })
}

/** Safe nested read on parsed JSON so assertions need no `any`. */
function dig(obj: unknown, ...path: string[]): unknown {
  let cur: unknown = obj
  for (const key of path) {
    if (cur === null || typeof cur !== 'object') return undefined
    cur = (cur as Record<string, unknown>)[key]
  }
  return cur
}

describe('edit flow (real DB)', () => {
  let prisma: PrismaClient
  let repo: MessageRepository
  let chatJid: string

  beforeAll(() => {
    prisma = getPrismaClient()
    repo = new MessageRepository(prisma)
  })
  afterAll(async () => {
    await prisma.$disconnect()
  })
  beforeEach(async () => {
    await resetDb(prisma)
    chatJid = pnJid()
    await makeChat(prisma, { jid: chatJid })
  })

  async function seedReply(): Promise<string> {
    const m = await makeMessage(prisma, chatJid, {
      messageType: 'extendedTextMessage',
      textContent: 'original reply',
      content: replyContent('original reply')
    })
    return m.id
  }
  async function read(id: string): Promise<{ row: Message; parsed: unknown }> {
    const row = await prisma.message.findUnique({ where: { id } })
    if (!row) throw new Error('missing row')
    return { row, parsed: JSON.parse(row.content ?? '{}') as unknown }
  }

  it('editMessage keeps quote and messageContextInfo for a text edit of a reply', async () => {
    const id = await seedReply()
    await repo.editMessage(id, 'edited reply', { conversation: 'edited reply' })
    const { row, parsed } = await read(id)
    expect(row.isEdited).toBe(true)
    expect(row.textContent).toBe('edited reply')
    expect(dig(parsed, 'extendedTextMessage', 'text')).toBe('edited reply')
    expect(dig(parsed, 'extendedTextMessage', 'contextInfo', 'quotedMessage', 'conversation')).toBe('original question')
    expect(dig(parsed, 'messageContextInfo')).toEqual(MCI)
  })

  it('B-MSG-04: the editedMessage echo (decryptMessage) keeps text, quote and messageContextInfo', async () => {
    const id = await seedReply()
    await repo.editMessage(id, 'edited reply', { conversation: 'edited reply' })
    await repo.decryptMessage(id, 'extendedTextMessage', 'edited reply', {
      editedMessage: { message: { conversation: 'edited reply' } }
    })
    const { parsed } = await read(id)
    expect(dig(parsed, 'extendedTextMessage', 'text')).toBe('edited reply')
    expect(dig(parsed, 'extendedTextMessage', 'contextInfo', 'quotedMessage', 'conversation')).toBe('original question')
    expect(dig(parsed, 'messageContextInfo')).toEqual(MCI)
    expect(dig(parsed, 'editedMessage')).toBeUndefined()
  })

  it('B-MSG-06: a caption edit keeps the media message (type, mediaKey, localURI)', async () => {
    const m = await makeMessage(prisma, chatJid, {
      messageType: 'imageMessage',
      textContent: 'old caption',
      content: JSON.stringify({
        imageMessage: { url: 'https://x/y', mediaKey: 'K', caption: 'old caption', localURI: 'file:///a.jpg' }
      })
    })
    await repo.editMessage(m.id, 'new caption', { imageMessage: { caption: 'new caption' } })
    const { row, parsed } = await read(m.id)
    expect(row.messageType).toBe('imageMessage')
    expect(row.textContent).toBe('new caption')
    expect(dig(parsed, 'imageMessage', 'caption')).toBe('new caption')
    expect(dig(parsed, 'imageMessage', 'mediaKey')).toBe('K')
    expect(dig(parsed, 'imageMessage', 'localURI')).toBe('file:///a.jpg')
  })
})

describe('UIBroadcastSubscriber.onDecrypted edit echo', () => {
  class Bus implements IWAEventBus {
    private h = new Map<string, AsyncHandler<never>[]>()
    on(e: string, fn: AsyncHandler<never>): this {
      this.h.set(e, [...(this.h.get(e) ?? []), fn])
      return this
    }
    off(): this {
      return this
    }
    async emit(e: string, d: unknown): Promise<void> {
      for (const fn of this.h.get(e) ?? []) await (fn as AsyncHandler<unknown>)(d)
    }
    removeAllListeners(): void {
      this.h.clear()
    }
  }

  async function run(echoContent: Record<string, unknown>): Promise<unknown> {
    const enrich = vi.fn().mockResolvedValue({ id: 'm' })
    const bus = new Bus()
    new UIBroadcastSubscriber(
      { batchResolveNames: vi.fn().mockResolvedValue(new Map()) } as unknown as IContactNameResolver,
      { enrichMessage: enrich } as unknown as IMessageQueryService,
      {
        findMessageById: vi.fn().mockResolvedValue({
          id: 'm',
          chatJid: 'c@s.whatsapp.net',
          messageType: 'extendedTextMessage',
          content: replyContent('edited reply'),
          isEdited: true
        })
      } as unknown as IMessageReadRepository,
      () => ({ isDestroyed: () => false, webContents: { send: vi.fn() } }) as unknown as BrowserWindow
    ).register(bus as unknown as IWAEventBus)
    await bus.emit('message:decrypted', {
      sock: {},
      messageId: 'm',
      chatJid: 'c@s.whatsapp.net',
      messageType: 'extendedTextMessage',
      textContent: 'edited reply',
      content: echoContent
    })
    const sent = enrich.mock.calls[0][0] as { content: string }
    return JSON.parse(sent.content) as unknown
  }

  it('echo without contextInfo keeps the quote', async () => {
    const out = await run({ editedMessage: { message: { conversation: 'edited reply' } } })
    expect(dig(out, 'extendedTextMessage', 'contextInfo', 'quotedMessage', 'conversation')).toBe('original question')
  })

  it('B-MSG-03: echo carrying partial contextInfo (no quotedMessage) keeps the quote', async () => {
    const out = await run({
      editedMessage: { message: { extendedTextMessage: { text: 'edited reply', contextInfo: { expiration: 86400 } } } }
    })
    expect(dig(out, 'extendedTextMessage', 'contextInfo', 'quotedMessage', 'conversation')).toBe('original question')
    expect(dig(out, 'extendedTextMessage', 'text')).toBe('edited reply')
  })
})
