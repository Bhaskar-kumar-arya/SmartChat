import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import { PrismaClient } from '@prisma/client'
import { getPrismaClient, resetDb } from '../helpers'
import {
  buildChatsUpsert,
  buildGroupMetadata,
  buildLidMappingUpdate,
  buildMessagesReaction,
  buildMessagesUpsert,
  lidJid,
  makeAlias,
  makeChat,
  makeChatMember,
  makeContact,
  makeIdentity,
  makeLidMap,
  makeMessage,
  makeReaction,
  pnJid
} from '../factories'

describe('test infra: resetDb + factories', () => {
  let prisma: PrismaClient

  beforeAll(() => {
    prisma = getPrismaClient()
  })

  afterAll(async () => {
    await prisma.$disconnect()
  })

  beforeEach(async () => {
    await resetDb(prisma)
  })

  /** Seeds one row in every FK-linked table plus the standalone ones. */
  async function seedEverything(): Promise<void> {
    const { identity } = await makeContact(prisma, { lid: lidJid(), pushName: 'Ann' })
    const chat = await makeChat(prisma, { type: 'GROUP' })
    await makeChatMember(prisma, chat.jid, identity.id)
    const msg = await makeMessage(prisma, chat.jid, { senderId: identity.id })
    await makeReaction(prisma, msg.id, identity.id)
    await makeLidMap(prisma)
    await prisma.messageReceipt.create({
      data: { messageId: msg.id, userJid: pnJid(), status: 'READ', timestamp: 1n }
    })
    await prisma.callLog.create({
      data: { id: 'c1', callerJid: pnJid(), status: 'offer', timestamp: 1n }
    })
    await prisma.community.create({ data: { jid: 'comm@g.us' } })
    await prisma.favoriteSticker.create({ data: { fileSha256: 'abc', fileName: 'a.webp', createdAt: 1n } })
  }

  it('resetDb empties every table, including FK-linked ones', async () => {
    await seedEverything()
    expect(await prisma.reaction.count()).toBe(1)

    await resetDb(prisma)

    const counts = await Promise.all([
      prisma.identity.count(),
      prisma.identityAlias.count(),
      prisma.chat.count(),
      prisma.chatMember.count(),
      prisma.message.count(),
      prisma.reaction.count(),
      prisma.lidMap.count(),
      prisma.messageReceipt.count(),
      prisma.callLog.count(),
      prisma.community.count(),
      prisma.favoriteSticker.count()
    ])
    expect(counts).toEqual(counts.map(() => 0))
  })

  it('resetDb is idempotent on an empty database', async () => {
    await resetDb(prisma)
    await resetDb(prisma)
    expect(await prisma.identity.count()).toBe(0)
  })

  it('resetDb restarts AUTOINCREMENT ids so tests are deterministic', async () => {
    const first = await makeIdentity(prisma)
    await resetDb(prisma)
    const second = await makeIdentity(prisma)
    expect(second.id).toBe(first.id)
    expect(second.id).toBe(1)
  })

  it('makeContact creates identity + PN alias, and an optional LID alias', async () => {
    const lid = lidJid()
    const { identity, pn } = await makeContact(prisma, { lid, displayName: 'Bob' })
    expect(identity.phoneNumber).toBe(pn)
    expect(identity.displayName).toBe('Bob')
    const aliases = await prisma.identityAlias.findMany({ where: { identityId: identity.id } })
    expect(aliases.map(a => [a.jid, a.type]).sort()).toEqual(
      [
        [lid, 'LID'],
        [pn, 'PN']
      ].sort()
    )
  })

  it('makeAlias infers LID vs PN from the jid suffix', async () => {
    const ident = await makeIdentity(prisma)
    const l = await makeAlias(prisma, ident.id, lidJid())
    const p = await makeAlias(prisma, ident.id, pnJid())
    expect(l.type).toBe('LID')
    expect(p.type).toBe('PN')
  })

  it('makeChat defaults: DM jid for DM, group jid otherwise; overrides win', async () => {
    const dm = await makeChat(prisma)
    const grp = await makeChat(prisma, { type: 'GROUP', name: 'G', unreadCount: 3 })
    expect(dm.jid.endsWith('@s.whatsapp.net')).toBe(true)
    expect(grp.jid.endsWith('@g.us')).toBe(true)
    expect(grp.name).toBe('G')
    expect(grp.unreadCount).toBe(3)
  })

  it('makeMessage / makeReaction produce unique, valid rows', async () => {
    const chat = await makeChat(prisma)
    const { identity } = await makeContact(prisma)
    const m1 = await makeMessage(prisma, chat.jid)
    const m2 = await makeMessage(prisma, chat.jid, { id: 'custom', textContent: 'hi', fromMe: true })
    expect(m1.id).not.toBe(m2.id)
    expect(m2.textContent).toBe('hi')
    expect(JSON.parse(m2.content)).toEqual({ conversation: 'hi' })
    const r = await makeReaction(prisma, m2.id, identity.id, { text: '❤️' })
    expect(r.text).toBe('❤️')
  })

  it('makeLidMap generates a distinct lid/pn pair per call', async () => {
    const a = await makeLidMap(prisma)
    const b = await makeLidMap(prisma, { source: 'x' })
    expect(a.lid).not.toBe(b.lid)
    expect(b.source).toBe('x')
  })

  it('wa event builders produce the shapes the handlers consume', () => {
    const up = buildMessagesUpsert({ chatJid: 'c@g.us', id: 'M1', text: 'yo', participant: 'p@lid', timestamp: 5 })
    expect(up.messages[0].key).toEqual({ remoteJid: 'c@g.us', fromMe: false, id: 'M1', participant: 'p@lid' })
    expect(up.messages[0].message.conversation).toBe('yo')

    const [re] = buildMessagesReaction({ chatJid: 'c', messageId: 'M1', senderJid: 's', text: '👍', timestamp: 7 })
    expect(re.reaction.senderTimestampMs).toBe(7000)
    expect(re.reaction.key.participant).toBe('s')

    expect(buildLidMappingUpdate('a@lid', 'b@s.whatsapp.net')).toEqual([{ lid: 'a@lid', pn: 'b@s.whatsapp.net' }])
    expect(buildChatsUpsert({ id: 'x', name: 'n' })).toEqual([{ id: 'x', name: 'n' }])
    expect(buildGroupMetadata({ id: 'g', participants: [{ id: 'p', admin: 'admin' }, { id: 'q' }] })).toEqual({
      id: 'g',
      subject: 'Test Group',
      participants: [
        { id: 'p', admin: 'admin' },
        { id: 'q', admin: null }
      ]
    })
  })
})
