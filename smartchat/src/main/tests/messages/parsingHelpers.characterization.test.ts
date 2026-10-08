import { describe, it, expect, vi } from 'vitest'
import { WAMessageStubType } from '@whiskeysockets/baileys'
import { extractTextContent } from '../../utils/messageUtils'
import { MessageParser } from '../../services/messages/MessageParser'
import { ProtocolMessageProcessor } from '../../services/messages/processors/ProtocolMessageProcessor'
import type { IMessageProcessingContext, IMessageServiceDependencyAccessor } from '../../services/messages/processors/IMessageProcessorStrategy'
import { WAEventHandler } from '../../services/whatsapp/WAEventHandler'
import type { IWAEventBus } from '../../services/whatsapp/IWAEventBus'
import type { WASocket } from '../../services/whatsapp/types'
import { SyncMessagesHandler } from '../../services/sync/SyncMessagesHandler'

/**
 * R-MSG-08 characterization: pins the text-extraction / stub / protocol parsing of each of the
 * independent implementations (messageUtils, MessageParser, ProtocolMessageProcessor,
 * WAEventHandler, SyncMessagesHandler) BEFORE they are unified. Where they disagree, both are
 * pinned and each caller keeps its own behaviour.
 */

type Msg = Record<string, unknown>

// ── 1. messageUtils.extractTextContent vs MessageParser.extractTextContent ────────────────
const parser = new MessageParser()

// [label, input, utils result, parser result]
const TEXT_CASES: Array<[string, Msg | null, string | null, string | null]> = [
  ['null', null, null, null],
  ['conversation', { conversation: 'hi' }, 'hi', 'hi'],
  ['empty conversation', { conversation: '' }, '', ''],
  ['extended', { extendedTextMessage: { text: 'ext' } }, 'ext', 'ext'],
  ['image caption', { imageMessage: { caption: 'img' } }, 'img', 'img'],
  ['video caption', { videoMessage: { caption: 'vid' } }, 'vid', 'vid'],
  ['document caption', { documentMessage: { caption: 'doc' } }, 'doc', 'doc'],
  ['audio caption', { audioMessage: { caption: 'aud' } }, 'aud', 'aud'],
  ['ptv caption', { ptvMessage: { caption: 'ptv' } }, 'ptv', 'ptv'],
  ['sticker', { stickerMessage: {} }, null, null],
  ['image without caption', { imageMessage: {} }, null, null],
  ['conversation wins over extended', { conversation: 'c', extendedTextMessage: { text: 'e' } }, 'c', 'c'],
  // DISAGREEMENT 1: empty extended text. utils returns '' (typeof check), parser falls through (truthy check).
  ['empty extended text', { extendedTextMessage: { text: '' } }, '', null],
  ['empty extended text + caption', { extendedTextMessage: { text: '' }, imageMessage: { caption: 'c' } }, '', 'c'],
  // DISAGREEMENT 2: media without caption followed by media with one. utils scans all, parser takes the first media object.
  ['captionless image + doc caption', { imageMessage: {}, documentMessage: { caption: 'd' } }, 'd', null],
  ['non-string caption', { imageMessage: { caption: 5 } }, null, null],
  // Neither unwraps: wrapped input yields null for both.
  ['ephemeral wrapped (not unwrapped)', { ephemeralMessage: { message: { conversation: 'x' } } }, null, null],
  ['protocol message', { protocolMessage: { type: 0 } }, null, null]
]

describe('R-MSG-08 characterization: extractTextContent implementations', () => {
  it.each(TEXT_CASES)('utils.extractTextContent: %s', (_l, input, utilsExpected) => {
    expect(extractTextContent(input)).toBe(utilsExpected)
  })
  it.each(TEXT_CASES)('MessageParser.extractTextContent: %s', (_l, input, _u, parserExpected) => {
    expect(parser.extractTextContent(input)).toBe(parserExpected)
  })
})

// ── 2. MessageParser.parseMessageSync ────────────────────────────────────────────────────
const base = { key: { id: 'm1', remoteJid: '123@s.whatsapp.net', fromMe: false }, messageTimestamp: 1700000000 }

describe('R-MSG-08 characterization: MessageParser.parseMessageSync', () => {
  it('plain text', () => {
    const p = parser.parseMessageSync({ ...base, message: { conversation: 'hello' } } as never)
    expect(p).toMatchObject({ messageType: 'conversation', textContent: 'hello', isDeleted: false })
    expect(p?.rawMessage).toEqual({ conversation: 'hello' })
  })
  it('extended text', () => {
    const p = parser.parseMessageSync({ ...base, message: { extendedTextMessage: { text: 'e' } } } as never)
    expect(p).toMatchObject({ messageType: 'extendedTextMessage', textContent: 'e' })
  })
  it('image caption', () => {
    const p = parser.parseMessageSync({ ...base, message: { imageMessage: { caption: 'cap' } } } as never)
    expect(p).toMatchObject({ messageType: 'imageMessage', textContent: 'cap' })
  })
  it('ephemeral-wrapped text: type/text from the unwrapped content, raw keeps the wrapper', () => {
    const message = { ephemeralMessage: { message: { conversation: 'eph' } } }
    const p = parser.parseMessageSync({ ...base, message } as never)
    expect(p).toMatchObject({ messageType: 'conversation', textContent: 'eph' })
    expect(p?.rawMessage).toEqual(message)
  })
  it('viewOnce-wrapped image', () => {
    const p = parser.parseMessageSync({ ...base, message: { viewOnceMessage: { message: { imageMessage: { caption: 'v' } } } } } as never)
    expect(p).toMatchObject({ messageType: 'imageMessage', textContent: 'v' })
  })
  it('protocol / reaction / secret messages are special -> null', () => {
    for (const message of [{ protocolMessage: { type: 0 } }, { reactionMessage: {} }, { secretEncryptedMessage: {} }, { encReactionMessage: {} }]) {
      expect(parser.parseMessageSync({ ...base, message } as never)).toBeNull()
    }
    expect(parser.isSpecialMessage({ message: { ephemeralMessage: { message: { protocolMessage: {} } } } } as never)).toBe(true)
  })
  it('senderKeyDistributionMessage -> null', () => {
    expect(parser.parseMessageSync({ ...base, message: { senderKeyDistributionMessage: {} } } as never)).toBeNull()
  })
  it('no message: unknown type, null text, null raw', () => {
    const p = parser.parseMessageSync({ ...base } as never)
    expect(p).toMatchObject({ messageType: 'unknown', textContent: null, rawMessage: null })
  })
  it('CIPHERTEXT stub -> ciphertext placeholder, raw content kept', () => {
    const p = parser.parseMessageSync({ ...base, messageStubType: WAMessageStubType.CIPHERTEXT, message: { conversation: 'x' } } as never)
    expect(p).toMatchObject({
      messageType: 'ciphertext',
      textContent: 'Waiting for this message. This may take a while.',
      rawMessage: { conversation: 'x' },
      isDeleted: false
    })
  })
  it('REVOKE stub -> isDeleted, type from content', () => {
    const p = parser.parseMessageSync({ ...base, messageStubType: WAMessageStubType.REVOKE } as never)
    expect(p).toMatchObject({ messageType: 'unknown', isDeleted: true })
  })
  it('other numeric stub -> system with stub name + parameters, text from content kept', () => {
    const p = parser.parseMessageSync({
      ...base,
      messageStubType: WAMessageStubType.GROUP_PARTICIPANT_ADD,
      messageStubParameters: ['a@s.whatsapp.net'],
      message: { conversation: 'ignored-type' }
    } as never)
    expect(p).toMatchObject({
      messageType: 'system',
      textContent: 'ignored-type',
      rawMessage: { stubType: 'GROUP_PARTICIPANT_ADD', parameters: ['a@s.whatsapp.net'] }
    })
  })
  it('unknown numeric stub -> UNKNOWN; string stub kept verbatim; missing params -> []', () => {
    const a = parser.parseMessageSync({ ...base, messageStubType: 99999 } as never)
    expect(a?.rawMessage).toEqual({ stubType: 'UNKNOWN', parameters: [] })
    const b = parser.parseMessageSync({ ...base, messageStubType: 'SOME_STUB' } as never)
    expect(b).toMatchObject({ messageType: 'system', rawMessage: { stubType: 'SOME_STUB', parameters: [] } })
  })
  it('participant: group without participant -> null; DM -> remote jid', () => {
    const g = parser.parseMessageSync({ key: { id: 'g', remoteJid: 'g@g.us' }, message: { conversation: 'x' } } as never)
    expect(g?.participantString).toBeNull()
    const d = parser.parseMessageSync({ ...base, message: { conversation: 'x' } } as never)
    expect(d?.participantString).toBe('123@s.whatsapp.net')
  })
  it('toDbRow serialises raw message', () => {
    const p = parser.parseMessageSync({ ...base, message: { conversation: 'x' } } as never)!
    expect(parser.toDbRow(p, 5)).toMatchObject({ content: '{"conversation":"x"}', senderId: 5, status: expect.any(String) })
  })
})

// ── 3. Edit text: ProtocolMessageProcessor (??) vs WAEventHandler (||) ───────────────────
async function processorEditText(editedMessage: Msg): Promise<unknown> {
  const ctx = {
    remoteJid: 'u@s.whatsapp.net',
    unwrapped: { protocolMessage: { type: 14, key: { id: 't' }, editedMessage } }
  } as unknown as IMessageProcessingContext
  const res = (await new ProtocolMessageProcessor().process(ctx, {} as IMessageServiceDependencyAccessor)) as {
    editedTextContent: unknown
  }
  return res.editedTextContent
}
async function handlerEditText(editedMessage: Msg): Promise<unknown> {
  const emit = vi.fn().mockResolvedValue(undefined)
  const handler = new WAEventHandler({} as never, {} as never, {} as never, {} as never, { emit } as unknown as IWAEventBus)
  const key = { id: 'm1', remoteJid: '123@s.whatsapp.net', fromMe: false }
  await handler.handleMessagesUpdate(
    [{ key, update: { protocolMessage: { type: 14, key, editedMessage } } }],
    {} as unknown as WASocket
  )
  const call = emit.mock.calls.find((c) => c[0] === 'message:edited')
  return (call?.[1] as { editedTextContent: unknown }).editedTextContent
}

// [label, editedMessage, processor result, handler result]
const EDIT_CASES: Array<[string, Msg, string | null, string | null]> = [
  ['conversation', { conversation: 'a' }, 'a', 'a'],
  ['extended', { extendedTextMessage: { text: 'b' } }, 'b', 'b'],
  ['image caption', { imageMessage: { caption: 'c' } }, 'c', 'c'],
  ['video caption', { videoMessage: { caption: 'd' } }, 'd', 'd'],
  ['document caption (ignored by both)', { documentMessage: { caption: 'e' } }, null, null],
  ['ephemeral-wrapped (not unwrapped by either)', { ephemeralMessage: { message: { conversation: 'f' } } }, null, null],
  ['nothing', {}, null, null],
  // DISAGREEMENT 3: empty-string text. `??` keeps '', `||` falls through to the next candidate.
  ['empty conversation', { conversation: '' }, '', null],
  ['empty conversation + extended', { conversation: '', extendedTextMessage: { text: 'x' } }, '', 'x']
]

describe('R-MSG-08 characterization: edited-text extraction', () => {
  it.each(EDIT_CASES)('ProtocolMessageProcessor: %s', async (_l, edited, expected) => {
    expect(await processorEditText(edited)).toBe(expected)
  })
  it.each(EDIT_CASES)('WAEventHandler: %s', async (_l, edited, _p, expected) => {
    expect(await handlerEditText(edited)).toBe(expected)
  })
  it('ProtocolMessageProcessor classifies numeric and string revoke/edit, ignores other types', async () => {
    const run = async (type: unknown): Promise<unknown> =>
      new ProtocolMessageProcessor().process(
        { remoteJid: 'u', unwrapped: { protocolMessage: { type, key: { id: 't' }, editedMessage: {} } } } as unknown as IMessageProcessingContext,
        {} as IMessageServiceDependencyAccessor
      )
    expect(await run(0)).toMatchObject({ subType: 'revoke' })
    expect(await run('REVOKE')).toMatchObject({ subType: 'revoke' })
    expect(await run(14)).toMatchObject({ subType: 'edit' })
    expect(await run('MESSAGE_EDIT')).toMatchObject({ subType: 'edit' })
    expect(await run(3)).toBeNull()
  })
})

// ── 4. WAEventHandler.tryEmitDecryptedMessage (extractTextContent on unwrapped) ──────────
describe('R-MSG-08 characterization: WAEventHandler message:decrypted', () => {
  const key = { id: 'm1', remoteJid: '123@s.whatsapp.net', fromMe: false }
  async function decrypted(message: Msg): Promise<Record<string, unknown> | undefined> {
    const emit = vi.fn().mockResolvedValue(undefined)
    const handler = new WAEventHandler({} as never, {} as never, {} as never, {} as never, { emit } as unknown as IWAEventBus)
    await handler.handleMessagesUpdate([{ key, update: { message } }], {} as unknown as WASocket)
    return emit.mock.calls.find((c) => c[0] === 'message:decrypted')?.[1] as Record<string, unknown> | undefined
  }
  it.each([
    ['conversation', { conversation: 'a' }, 'conversation', 'a'],
    ['empty extended text (utils semantics)', { extendedTextMessage: { text: '' } }, 'extendedTextMessage', ''],
    ['image caption', { imageMessage: { caption: 'c' } }, 'imageMessage', 'c'],
    ['ephemeral wrapped', { ephemeralMessage: { message: { extendedTextMessage: { text: 'w' } } } }, 'extendedTextMessage', 'w'],
    ['viewOnce wrapped', { viewOnceMessageV2: { message: { imageMessage: { caption: 'v' } } } }, 'imageMessage', 'v'],
    ['sticker', { stickerMessage: {} }, 'stickerMessage', null]
  ])('%s', async (_l, message, type, text) => {
    expect(await decrypted(message)).toMatchObject({ messageId: 'm1', messageType: type, textContent: text, content: message })
  })
  it('senderKeyDistributionMessage is not emitted', async () => {
    expect(await decrypted({ senderKeyDistributionMessage: {} })).toBeUndefined()
  })
})

// ── 5. SyncMessagesHandler ───────────────────────────────────────────────────────────────
interface Row {
  id: string
  messageType: string
  content: string
  textContent: string | null
  fromMe: boolean
  participant: string | null
  isEdited: boolean
  isDeleted: boolean
  timestamp: bigint
}
async function runSync(
  messages: Msg[],
  meJid: string | null = null
): Promise<{ rows: Row[]; reactions: Array<Record<string, unknown>> }> {
  const bulkSyncMessages = vi.fn().mockImplementation(async (rows: Row[]) => rows)
  const bulkSyncReactions = vi.fn().mockResolvedValue(undefined)
  const ids = new Map<string, number>()
  const contactService = {
    batchGetIdentityIds: vi.fn().mockImplementation(async (jids: string[]) => {
      const out = new Map<string, number>()
      for (const j of jids) {
        if (!ids.has(j)) ids.set(j, 100 + ids.size)
        out.set(j, ids.get(j) as number)
      }
      return out
    }),
    upsertContact: vi.fn().mockResolvedValue(undefined),
    getIdentityIdByJid: vi.fn().mockImplementation(async (j: string) => ids.get(j) ?? null)
  }
  const handler = new SyncMessagesHandler(
    { bulkSyncMessages } as never,
    { bulkSyncReactions } as never,
    { findAllAliases: vi.fn().mockResolvedValue([]) } as never,
    { upsertChat: vi.fn().mockResolvedValue(undefined) } as never,
    contactService as never
  )
  await handler.processMessages(messages, new Set(['chat@s.whatsapp.net', 'g@g.us']), meJid, 7)
  const rows = (bulkSyncMessages.mock.calls[0]?.[0] ?? []) as Row[]
  const reactions = bulkSyncReactions.mock.calls.flatMap((c) => c[0] as Array<Record<string, unknown>>)
  return { rows, reactions }
}
const sk = (id: string, extra: Msg = {}): Msg => ({
  key: { id, remoteJid: 'chat@s.whatsapp.net', fromMe: false },
  messageTimestamp: 1700000000,
  ...extra
})

describe('R-MSG-08 characterization: SyncMessagesHandler row parsing', () => {
  it.each([
    ['conversation', { conversation: 'a' }, 'conversation', 'a'],
    ['extended', { extendedTextMessage: { text: 'e' } }, 'extendedTextMessage', 'e'],
    ['empty extended text (utils semantics)', { extendedTextMessage: { text: '' } }, 'extendedTextMessage', ''],
    ['image caption', { imageMessage: { caption: 'c' } }, 'imageMessage', 'c'],
    ['ephemeral wrapped', { ephemeralMessage: { message: { conversation: 'w' } } }, 'conversation', 'w'],
    ['viewOnce wrapped', { viewOnceMessage: { message: { imageMessage: { caption: 'v' } } } }, 'imageMessage', 'v'],
    ['sticker', { stickerMessage: {} }, 'stickerMessage', null]
  ])('%s', async (_l, message, type, text) => {
    const { rows } = await runSync([sk('m1', { message })])
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({
      id: 'm1',
      messageType: type,
      textContent: text,
      content: JSON.stringify(message),
      isEdited: false,
      isDeleted: false,
      fromMe: false,
      participant: 'chat@s.whatsapp.net'
    })
  })

  it('no message -> unknown / {} / null text', async () => {
    const { rows } = await runSync([sk('m1')])
    expect(rows[0]).toMatchObject({ messageType: 'unknown', content: '{}', textContent: null })
  })

  it('senderKeyDistributionMessage rows are dropped', async () => {
    const { rows } = await runSync([sk('m1', { message: { senderKeyDistributionMessage: {} } })])
    expect(rows).toEqual([])
  })

  it('CIPHERTEXT stub -> ciphertext placeholder, content kept', async () => {
    const { rows } = await runSync([sk('m1', { messageStubType: WAMessageStubType.CIPHERTEXT, message: { conversation: 'x' } })])
    expect(rows[0]).toMatchObject({
      messageType: 'ciphertext',
      textContent: 'Waiting for this message. This may take a while.',
      content: '{"conversation":"x"}'
    })
  })

  // DISAGREEMENT 4: other stubs are 'system' for MessageParser, but the sync handler keeps the content-derived type.
  it('other stubs are NOT classified as system by the sync handler', async () => {
    const { rows } = await runSync([
      sk('m1', { messageStubType: WAMessageStubType.GROUP_PARTICIPANT_ADD, messageStubParameters: ['a'], message: { conversation: 'x' } })
    ])
    expect(rows[0]).toMatchObject({ messageType: 'conversation', textContent: 'x', content: '{"conversation":"x"}' })
  })

  it('REVOKE stub with parameter -> row for the target id, deleted, blank', async () => {
    const { rows } = await runSync([sk('m1', { messageStubType: WAMessageStubType.REVOKE, messageStubParameters: ['target'] })])
    expect(rows[0]).toMatchObject({ id: 'target', messageType: 'unknown', content: '{}', textContent: null, isDeleted: true, isEdited: false })
  })

  it('REVOKE stub without parameter -> dropped', async () => {
    const { rows } = await runSync([sk('m1', { messageStubType: WAMessageStubType.REVOKE })])
    expect(rows).toEqual([])
  })

  it('protocol REVOKE (numeric and string) -> target id, deleted, original protocol content kept', async () => {
    const mk = (type: unknown): Msg =>
      sk('m1', { message: { protocolMessage: { type, key: { id: 'target', fromMe: true, remoteJid: 'g@g.us', participant: 'p@s.whatsapp.net' } } } })
    for (const type of [0, 'REVOKE']) {
      const { rows } = await runSync([mk(type)])
      expect(rows[0]).toMatchObject({
        id: 'target',
        messageType: 'protocolMessage',
        isDeleted: true,
        isEdited: false,
        fromMe: true,
        participant: 'p@s.whatsapp.net'
      })
    }
  })

  it('protocol EDIT (numeric and string) -> target id, edited content/type/text from the edited message', async () => {
    const editedMessage = { extendedTextMessage: { text: 'new' } }
    for (const type of [14, 'MESSAGE_EDIT']) {
      const { rows } = await runSync([
        sk('m1', { message: { protocolMessage: { type, key: { id: 'target', fromMe: false, remoteJid: 'g@g.us' }, editedMessage } } })
      ])
      expect(rows[0]).toMatchObject({
        id: 'target',
        messageType: 'extendedTextMessage',
        content: JSON.stringify(editedMessage),
        textContent: 'new',
        isEdited: true,
        isDeleted: false,
        fromMe: false,
        participant: null
      })
    }
  })

  it('protocol EDIT of a wrapped edited message unwraps for type/text but stores the wrapper', async () => {
    const editedMessage = { ephemeralMessage: { message: { imageMessage: { caption: 'cap' } } } }
    const { rows } = await runSync([
      sk('m1', { message: { protocolMessage: { type: 14, key: { id: 'target', remoteJid: 'chat@s.whatsapp.net' }, editedMessage } } })
    ])
    expect(rows[0]).toMatchObject({
      id: 'target',
      messageType: 'imageMessage',
      textContent: 'cap',
      content: JSON.stringify(editedMessage),
      participant: 'chat@s.whatsapp.net'
    })
  })

  it('other protocol types (and edit without editedMessage) stay plain protocolMessage rows', async () => {
    const { rows } = await runSync([
      sk('a', { message: { protocolMessage: { type: 3, key: { id: 'x' } } } }),
      sk('b', { message: { protocolMessage: { type: 14, key: { id: 'x' } } } })
    ])
    expect(rows.map((r) => [r.id, r.messageType, r.isEdited, r.isDeleted])).toEqual([
      ['a', 'protocolMessage', false, false],
      ['b', 'protocolMessage', false, false]
    ])
  })
})

describe('R-MSG-08 characterization: SyncMessagesHandler reactions', () => {
  it('nested reactions: reactor from participant, DM remoteJid, or me; ts seconds / ms / Long', async () => {
    const { reactions } = await runSync(
      [
        sk('m1', {
          message: { conversation: 'x' },
          reactions: [
            { text: '👍', key: { participant: 'p1@s.whatsapp.net' }, senderTimestampMs: 1700000000000 },
            { text: '🔥', key: { remoteJid: 'chat@s.whatsapp.net' }, senderTimestampMs: 1700000001 },
            { text: '❤️', key: { fromMe: true, remoteJid: 'g@g.us' }, senderTimestampMs: { low: 1700000002, high: 0 } },
            { text: '😮', key: { remoteJid: 'g@g.us' }, senderTimestampMs: 1700000003 },
            { text: '', key: { participant: 'p1@s.whatsapp.net' } },
            { text: 'no key' }
          ]
        })
      ],
      'me@s.whatsapp.net'
    )
    expect(reactions).toEqual([
      { targetId: 'm1', reactorId: 101, emoji: '👍', timestamp: 1700000000n },
      { targetId: 'm1', reactorId: 100, emoji: '🔥', timestamp: 1700000001n },
      { targetId: 'm1', reactorId: 102, emoji: '❤️', timestamp: 1700000002n }
    ])
  })

  it('nested reaction without a timestamp uses "now" in seconds', async () => {
    const before = BigInt(Math.floor(Date.now() / 1000))
    const { reactions } = await runSync([
      sk('m1', { message: { conversation: 'x' }, reactions: [{ text: '👍', key: { participant: 'p@s.whatsapp.net' } }] })
    ])
    const ts = reactions[0].timestamp as bigint
    expect(ts >= before && ts <= before + 5n).toBe(true)
  })

  it('inline reactionMessage rows become reactions (not messages); fromMe -> me identity; ts is the message ts', async () => {
    const { rows, reactions } = await runSync([
      sk('r1', {
        key: { id: 'r1', remoteJid: 'chat@s.whatsapp.net', fromMe: true },
        message: { reactionMessage: { key: { id: 'tgt' }, text: '👍' } }
      }),
      sk('r2', {
        key: { id: 'r2', remoteJid: 'g@g.us', participant: 'p@s.whatsapp.net', fromMe: false },
        message: { ephemeralMessage: { message: { reactionMessage: { key: { id: 'tgt2' }, text: '🔥' } } } }
      }),
      sk('r3', { message: { reactionMessage: { key: { id: 'tgt3' }, text: '' } } })
    ])
    expect(rows.map((r) => r.id)).toEqual([])
    expect(reactions).toEqual([
      { targetId: 'tgt', reactorId: 7, emoji: '👍', timestamp: 1700000000n },
      { targetId: 'tgt2', reactorId: 100, emoji: '🔥', timestamp: 1700000000n }
    ])
  })
})
