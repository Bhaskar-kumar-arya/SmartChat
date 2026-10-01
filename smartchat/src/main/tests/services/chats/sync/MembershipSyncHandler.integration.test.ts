import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest'
import { PrismaClient } from '@prisma/client'
import { getPrismaClient, resetDb } from '../../../helpers'
import { MembershipSyncHandler } from '../../../../services/chats/sync/MembershipSyncHandler'
import { SyncRepository } from '../../../../services/sync/SyncRepository'
import type { IContactCacheManager } from '../../../../services/contacts/IContactService'
import type { BaileysGroupMetadata } from '../../../../services/whatsapp/types/group.types'
import { groupJid, lidJid, makeChat, makeChatMember, makeContact, pnJid } from '../../../factories'

/**
 * F-DATA-2 / R-DATA-05: real-DB characterization of MembershipSyncHandler.syncMemberships
 * (full group hydration -> identities, aliases, LidMap, ChatMember).
 */
describe('MembershipSyncHandler (real DB)', () => {
  let prisma: PrismaClient
  let handler: MembershipSyncHandler

  beforeAll(() => {
    prisma = getPrismaClient()
  })
  afterAll(async () => {
    await prisma.$disconnect()
  })
  beforeEach(async () => {
    await resetDb(prisma)
    const cache = { warmLinkCache: vi.fn(), populateIdentityIdCache: vi.fn() } as unknown as IContactCacheManager
    handler = new MembershipSyncHandler(new SyncRepository(prisma), cache)
  })

  type Participants = NonNullable<BaileysGroupMetadata['participants']>

  async function sync(jid: string, participants: Participants, extra: BaileysGroupMetadata = {}): Promise<void> {
    await handler.syncMemberships({ [jid]: { id: jid, participants, ...extra } })
  }

  async function memberIdentityIds(jid: string): Promise<number[]> {
    const rows = await prisma.chatMember.findMany({ where: { chatJid: jid } })
    return rows.map((r) => r.identityId).sort((a, b) => a - b)
  }

  it('does nothing for an empty batch', async () => {
    await handler.syncMemberships({})
    expect(await prisma.identity.count()).toBe(0)
  })

  it('creates identity, both aliases, LidMap and member for a new LID+PN participant', async () => {
    const jid = groupJid()
    await makeChat(prisma, { jid, type: 'GROUP' })
    const lid = lidJid()
    const pn = pnJid()
    await sync(jid, [{ id: lid, lid, phoneNumber: pn, admin: 'admin' }])

    const identity = await prisma.identity.findUniqueOrThrow({ where: { phoneNumber: pn } })
    // Current behaviour: only the LID alias is written; a brand-new PN identity gets no PN alias row
    // (it is found via Identity.phoneNumber instead).
    const aliases = await prisma.identityAlias.findMany({ where: { identityId: identity.id } })
    expect(aliases.map((a) => a.jid)).toEqual([lid])
    expect(await prisma.lidMap.findUnique({ where: { lid } })).toMatchObject({ pn })
    expect(await prisma.chatMember.findMany({ where: { chatJid: jid } })).toMatchObject([
      { identityId: identity.id, role: 'ADMIN' }
    ])
  })

  it('creates a PN identity for a PN-only participant and maps superadmin', async () => {
    const jid = groupJid()
    await makeChat(prisma, { jid, type: 'GROUP' })
    const pn = pnJid()
    await sync(jid, [{ id: pn, admin: 'superadmin' }])

    const identity = await prisma.identity.findUniqueOrThrow({ where: { phoneNumber: pn } })
    expect(await prisma.chatMember.findMany({ where: { chatJid: jid } })).toMatchObject([
      { identityId: identity.id, role: 'SUPERADMIN' }
    ])
  })

  it('creates a phone-less stub identity and member for a LID-only participant with no known PN', async () => {
    const jid = groupJid()
    await makeChat(prisma, { jid, type: 'GROUP' })
    await sync(jid, [{ id: lidJid() }])

    const identity = await prisma.identity.findFirstOrThrow()
    expect(identity.phoneNumber).toBeNull()
    expect(await memberIdentityIds(jid)).toEqual([identity.id])
  })

  // Found while characterizing (same family as B-DATA-02): the stub's LID alias is never persisted,
  // so every re-hydration creates another stub for the same LID.
  it('persists the LID alias of a stub and does not duplicate it on re-hydration', async () => {
    const jid = groupJid()
    await makeChat(prisma, { jid, type: 'GROUP' })
    const lid = lidJid()
    await sync(jid, [{ id: lid }])
    await sync(jid, [{ id: lid }])

    const alias = await prisma.identityAlias.findUniqueOrThrow({ where: { jid: lid } })
    expect(await prisma.identity.count()).toBe(1)
    expect(await memberIdentityIds(jid)).toEqual([alias.identityId])
  })

  it('reuses an existing identity found via PN alias, adds the LID alias and updates the role', async () => {
    const jid = groupJid()
    await makeChat(prisma, { jid, type: 'GROUP' })
    const { identity, pn } = await makeContact(prisma)
    await makeChatMember(prisma, jid, identity.id, { role: 'MEMBER' })
    const lid = lidJid()
    await sync(jid, [{ id: lid, lid, phoneNumber: pn, admin: 'admin' }])

    expect(await prisma.identity.count()).toBe(1)
    expect(await prisma.identityAlias.findUnique({ where: { jid: lid } })).toMatchObject({ identityId: identity.id })
    expect(await prisma.chatMember.findMany({ where: { chatJid: jid } })).toMatchObject([
      { identityId: identity.id, role: 'ADMIN' }
    ])
  })

  it('keeps the same identity for one person across two groups', async () => {
    const g1 = groupJid()
    const g2 = groupJid()
    await makeChat(prisma, { jid: g1, type: 'GROUP' })
    await makeChat(prisma, { jid: g2, type: 'GROUP' })
    const pn = pnJid()
    await handler.syncMemberships({
      [g1]: { id: g1, participants: [{ id: pn }] },
      [g2]: { id: g2, participants: [{ id: pn, admin: 'admin' }] }
    })
    expect(await prisma.identity.count()).toBe(1)
    expect(await prisma.chatMember.count()).toBe(2)
  })

  it('leaves existing members alone when metadata has no participants (no prune)', async () => {
    const jid = groupJid()
    await makeChat(prisma, { jid, type: 'GROUP' })
    const { identity } = await makeContact(prisma)
    await makeChatMember(prisma, jid, identity.id)
    await sync(jid, [])
    expect(await memberIdentityIds(jid)).toEqual([identity.id])
  })

  // B-DATA-02: a LID-only participant whose PN is known only via the group owner's ownerPn
  it('links a LID-only participant to the PN derived from ownerPn and records the member (B-DATA-02)', async () => {
    const jid = groupJid()
    await makeChat(prisma, { jid, type: 'GROUP' })
    const lid = lidJid()
    const pn = pnJid()
    await sync(jid, [{ id: lid, admin: 'superadmin' }], { owner: lid, ownerPn: pn })

    const identity = await prisma.identity.findUniqueOrThrow({ where: { phoneNumber: pn } })
    expect(await prisma.identityAlias.findUnique({ where: { jid: lid } })).toMatchObject({ identityId: identity.id })
    expect(await prisma.chatMember.findMany({ where: { chatJid: jid } })).toMatchObject([
      { identityId: identity.id, role: 'SUPERADMIN' }
    ])
  })

  // B-DATA-03: hydration is authoritative, departed members must go
  it.fails('removes members absent from the hydrated participant list (B-DATA-03)', async () => {
    const jid = groupJid()
    await makeChat(prisma, { jid, type: 'GROUP' })
    const stayer = await makeContact(prisma)
    const leaver = await makeContact(prisma)
    await makeChatMember(prisma, jid, stayer.identity.id)
    await makeChatMember(prisma, jid, leaver.identity.id)
    await sync(jid, [{ id: stayer.pn }])

    expect(await memberIdentityIds(jid)).toEqual([stayer.identity.id])
  })
})
