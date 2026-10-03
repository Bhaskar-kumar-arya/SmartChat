import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { PrismaClient } from '@prisma/client'
import { WAEventBus } from '../../../services/whatsapp/WAEventBus'
import { WAEventHandler } from '../../../services/whatsapp/WAEventHandler'
import { ServiceContainer } from '../../../ServiceContainer'
import { getPrismaClient, clearDatabase, createMockSocket, createTestServiceContainer, injectEvent } from '../../helpers'
import { groupJid, lidJid, makeChat, makeChatMember, makeContact, pnJid } from '../../factories'

/**
 * F-DATA-3 / R-DATA-06: real-DB characterization of the LIVE participant-sync path
 * (`group-participants.update` and `groups.update` with participants).
 */
describe('Live participant sync (real DB)', () => {
  let prisma: PrismaClient
  let bus: WAEventBus
  let services: ServiceContainer
  let handler: WAEventHandler
  let sock: ReturnType<typeof createMockSocket>

  beforeEach(async () => {
    vi.clearAllMocks()
    prisma = getPrismaClient()
    await clearDatabase(prisma)
    bus = new WAEventBus()
    services = createTestServiceContainer(prisma, bus)
    handler = new WAEventHandler(
      services.messageProcessingService,
      services.messageParserService,
      services.contactService,
      services.messageQueryService,
      bus,
      () => Promise.resolve(false)
    )
    sock = createMockSocket()
  })

  afterEach(async () => {
    bus.removeAllListeners()
    await prisma.$disconnect()
  })

  const participantsUpdate = (id: string, participants: string[], action: string): Promise<void> =>
    injectEvent('group-participants.update', { id, participants, action }, services, handler, sock)
  const groupsUpdate = (update: Record<string, unknown>): Promise<void> =>
    injectEvent('groups.update', [update], services, handler, sock)

  async function members(chatJid: string): Promise<Array<{ jid: string; role: string }>> {
    const rows = await prisma.chatMember.findMany({
      where: { chatJid },
      include: { identity: { include: { aliases: true } } }
    })
    return rows
      .map((r) => ({ jid: r.identity.phoneNumber ?? r.identity.aliases[0]?.jid ?? '', role: r.role }))
      .sort((a, b) => a.jid.localeCompare(b.jid))
  }

  it('add creates the identity and a MEMBER row', async () => {
    const g = groupJid()
    await makeChat(prisma, { jid: g, type: 'GROUP' })
    const pn = pnJid()
    await participantsUpdate(g, [pn], 'add')
    expect(await members(g)).toEqual([{ jid: pn, role: 'MEMBER' }])
  })

  it('add creates the parent Chat row when it does not exist yet', async () => {
    const g = groupJid()
    const pn = pnJid()
    await participantsUpdate(g, [pn], 'add')
    expect(await prisma.chat.findUnique({ where: { jid: g } })).toMatchObject({ type: 'GROUP' })
    expect(await members(g)).toEqual([{ jid: pn, role: 'MEMBER' }])
  })

  it('promote -> ADMIN, demote -> MEMBER, for several participants at once', async () => {
    const g = groupJid()
    await makeChat(prisma, { jid: g, type: 'GROUP' })
    const a = pnJid()
    const b = pnJid()
    await participantsUpdate(g, [a, b], 'add')
    await participantsUpdate(g, [a, b], 'promote')
    expect((await members(g)).map((m) => m.role)).toEqual(['ADMIN', 'ADMIN'])
    await participantsUpdate(g, [a], 'demote')
    const byJid = new Map((await members(g)).map((m) => [m.jid, m.role]))
    expect(byJid.get(a)).toBe('MEMBER')
    expect(byJid.get(b)).toBe('ADMIN')
  })

  it('remove deletes only the removed member', async () => {
    const g = groupJid()
    await makeChat(prisma, { jid: g, type: 'GROUP' })
    const a = pnJid()
    const b = pnJid()
    await participantsUpdate(g, [a, b], 'add')
    await participantsUpdate(g, [a], 'remove')
    expect(await members(g)).toEqual([{ jid: b, role: 'MEMBER' }])
  })

  it('a LID aliased to an existing PN identity resolves to it, no duplicate identity', async () => {
    const g = groupJid()
    await makeChat(prisma, { jid: g, type: 'GROUP' })
    const lid = lidJid()
    const c = await makeContact(prisma, { pn: pnJid(), lid })
    const before = await prisma.identity.count()
    await participantsUpdate(g, [lid], 'add')
    expect(await prisma.identity.count()).toBe(before)
    const rows = await prisma.chatMember.findMany({ where: { chatJid: g } })
    expect(rows.map((r) => r.identityId)).toEqual([c.identity.id])
  })

  it('groups.update with participants links LID+PN, assigns roles, and never prunes absent members', async () => {
    const g = groupJid()
    await makeChat(prisma, { jid: g, type: 'GROUP' })
    const existing = await makeContact(prisma)
    await makeChatMember(prisma, g, existing.identity.id)
    const lid = lidJid()
    const pn = pnJid()
    await groupsUpdate({ id: g, participants: [{ id: lid, lid, phoneNumber: pn, admin: 'superadmin' }] })

    expect(await prisma.lidMap.findUnique({ where: { lid } })).toMatchObject({ pn })
    const identity = await prisma.identity.findUniqueOrThrow({ where: { phoneNumber: pn } })
    const rows = await prisma.chatMember.findMany({ where: { chatJid: g } })
    expect(rows.find((r) => r.identityId === identity.id)?.role).toBe('SUPERADMIN')
    expect(rows.some((r) => r.identityId === existing.identity.id)).toBe(true)
  })
})
