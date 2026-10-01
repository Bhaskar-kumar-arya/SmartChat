import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import { PrismaClient } from '@prisma/client'
import { getPrismaClient, resetDb } from '../helpers'
import { IdentityRepository } from '../../services/contacts/IdentityRepository'
import { AliasRepository } from '../../services/contacts/AliasRepository'
import { LidMapRepository } from '../../services/contacts/LidMapRepository'
import { LidPnLinker } from '../../services/contacts/LidPnLinker'
import { IdentityReconciliationService } from '../../services/contacts/IdentityReconciliationService'
import type { IContactMutationService } from '../../services/contacts/IContactService'
import {
  groupJid,
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

/**
 * F-DATA-1 / R-DATA-02: real-DB characterization of identity linking and merging
 * (LidPnLinker, IdentityRepository.mergeIdentityInto, deduplicateIdentities).
 */
describe('identity linking + merging (real DB)', () => {
  let prisma: PrismaClient
  let identityRepo: IdentityRepository
  let linker: LidPnLinker
  let reconciliation: IdentityReconciliationService

  beforeAll(() => {
    prisma = getPrismaClient()
  })
  afterAll(async () => {
    await prisma.$disconnect()
  })
  beforeEach(async () => {
    await resetDb(prisma)
    identityRepo = new IdentityRepository(prisma)
    linker = new LidPnLinker(identityRepo, new AliasRepository(prisma), new LidMapRepository(prisma))
    reconciliation = new IdentityReconciliationService(prisma, {} as IContactMutationService)
  })

  /** A LID-only stub: no phoneNumber, one LID alias, optional pushName. */
  async function makeStub(pushName: string | null = null): Promise<{ id: number; lid: string }> {
    const lid = lidJid()
    const stub = await makeIdentity(prisma, { pushName })
    await makeAlias(prisma, stub.id, lid, 'LID')
    return { id: stub.id, lid }
  }

  describe('LidPnLinker.linkLidAndPn', () => {
    it('creates one identity with both aliases when neither side exists', async () => {
      const lid = lidJid()
      const pn = pnJid()
      await linker.linkLidAndPn(lid, pn, 'test')

      const identity = await prisma.identity.findUniqueOrThrow({ where: { phoneNumber: pn } })
      const aliases = await prisma.identityAlias.findMany({ where: { identityId: identity.id } })
      expect(aliases.map((a) => a.jid).sort()).toEqual([lid, pn].sort())
      expect(await prisma.lidMap.findUnique({ where: { lid } })).toMatchObject({ pn })
    })

    it('gives a LID-only stub the phone number when no PN identity exists', async () => {
      const stub = await makeStub('Stubby')
      const pn = pnJid()
      await linker.linkLidAndPn(stub.lid, pn, 'test')

      const after = await prisma.identity.findUniqueOrThrow({ where: { id: stub.id } })
      expect(after.phoneNumber).toBe(pn)
      expect(await prisma.identityAlias.findUnique({ where: { jid: pn } })).toMatchObject({ identityId: stub.id })
    })

    it('points a fresh LID at the existing PN identity and leaves unrelated identities alone', async () => {
      const { identity: pnIdentity, pn } = await makeContact(prisma)
      const lid = lidJid()
      const bystander = await makeIdentity(prisma)

      await linker.linkLidAndPn(lid, pn, 'test')

      expect(await prisma.identityAlias.findUnique({ where: { jid: lid } })).toMatchObject({
        identityId: pnIdentity.id
      })
      expect(await prisma.identity.findUnique({ where: { id: bystander.id } })).not.toBeNull()
    })

    it('deletes a reference-free orphan stub once the LID alias is re-pointed', async () => {
      const { identity: pnIdentity, pn } = await makeContact(prisma)
      const stub = await makeStub()

      await linker.linkLidAndPn(stub.lid, pn, 'test')

      expect(await prisma.identityAlias.findUnique({ where: { jid: stub.lid } })).toMatchObject({
        identityId: pnIdentity.id
      })
      expect(await prisma.identity.findUnique({ where: { id: stub.id } })).toBeNull()
    })

    /**
     * B-DATA-01: the stub that held the LID alias is replaced by the PN identity but its
     * messages/reactions/memberships stay behind on an alias-less identity (permanent split).
     */
    it.fails('B-DATA-01: migrates the stub rows onto the PN identity and removes the stub', async () => {
      const { identity: pnIdentity, pn } = await makeContact(prisma)
      const stub = await makeStub('Stubby')
      const chat = await makeChat(prisma, { type: 'GROUP', jid: groupJid() })
      await makeChatMember(prisma, chat.jid, stub.id)
      const msg = await makeMessage(prisma, chat.jid, { senderId: stub.id })
      await makeReaction(prisma, msg.id, stub.id)

      await linker.linkLidAndPn(stub.lid, pn, 'test')

      expect(await prisma.identity.findUnique({ where: { id: stub.id } })).toBeNull()
      expect((await prisma.message.findUniqueOrThrow({ where: { id: msg.id } })).senderId).toBe(pnIdentity.id)
      expect(await prisma.chatMember.count({ where: { identityId: pnIdentity.id } })).toBe(1)
      expect(await prisma.reaction.count({ where: { senderId: pnIdentity.id } })).toBe(1)
      expect(await prisma.identityAlias.findUnique({ where: { jid: stub.lid } })).toMatchObject({
        identityId: pnIdentity.id
      })
    })

    /**
     * Smoke 2026-10-01 (a): a burst of lid-mapping.update for one PN does find-then-create
     * and the loser hits `Unique constraint failed (phoneNumber)` (P2002).
     */
    it.fails('a burst of links for the same new PN does not throw P2002', async () => {
      const pn = pnJid()
      const results = await Promise.allSettled([
        linker.linkLidAndPn(lidJid(), pn, 'test'),
        linker.linkLidAndPn(lidJid(), pn, 'test'),
        linker.linkLidAndPn(lidJid(), pn, 'test')
      ])
      expect(results.filter((r) => r.status === 'rejected')).toEqual([])
      expect(await prisma.identity.count({ where: { phoneNumber: pn } })).toBe(1)
    })
  })

  describe('IdentityRepository.mergeIdentityInto', () => {
    it('re-points children, resolves PK conflicts, enriches the survivor and deletes the source', async () => {
      const keep = await makeIdentity(prisma, { phoneNumber: pnJid(), displayName: 'Keep' })
      const from = await makeIdentity(prisma, { displayName: 'Dropped', pushName: 'Pushy', verifiedName: 'Verified' })
      await makeAlias(prisma, from.id, lidJid(), 'LID')
      const shared = await makeChat(prisma, { type: 'GROUP', jid: groupJid() })
      const only = await makeChat(prisma, { type: 'GROUP', jid: groupJid() })
      await makeChatMember(prisma, shared.jid, keep.id)
      await makeChatMember(prisma, shared.jid, from.id)
      await makeChatMember(prisma, only.jid, from.id)
      const m1 = await makeMessage(prisma, shared.jid, { senderId: from.id })
      await makeReaction(prisma, m1.id, keep.id)
      await makeReaction(prisma, m1.id, from.id)
      const m2 = await makeMessage(prisma, shared.jid, { senderId: keep.id })
      await makeReaction(prisma, m2.id, from.id)

      await identityRepo.mergeIdentityInto(from.id, keep.id)

      expect(await prisma.identity.findUnique({ where: { id: from.id } })).toBeNull()
      expect(await prisma.identityAlias.count({ where: { identityId: keep.id } })).toBe(1)
      expect((await prisma.message.findUniqueOrThrow({ where: { id: m1.id } })).senderId).toBe(keep.id)
      expect(await prisma.chatMember.count({ where: { identityId: keep.id } })).toBe(2)
      expect(await prisma.reaction.count({ where: { senderId: keep.id } })).toBe(2)
      const after = await prisma.identity.findUniqueOrThrow({ where: { id: keep.id } })
      expect(after).toMatchObject({ displayName: 'Keep', pushName: 'Pushy', verifiedName: 'Verified' })
    })

    it('is a no-op for the same id', async () => {
      const a = await makeIdentity(prisma)
      await identityRepo.mergeIdentityInto(a.id, a.id)
      expect(await prisma.identity.findUnique({ where: { id: a.id } })).not.toBeNull()
    })
  })

  describe('IdentityReconciliationService.deduplicateIdentities', () => {
    it('merges a corroborated stub with its rows into the single PN identity', async () => {
      const { identity: keep, pn } = await makeContact(prisma, { pushName: 'John Smith' })
      const stub = await makeStub('John Smith')
      const chat = await makeChat(prisma, { type: 'GROUP', jid: groupJid() })
      await makeChatMember(prisma, chat.jid, stub.id)
      const msg = await makeMessage(prisma, chat.jid, { senderId: stub.id })
      await makeReaction(prisma, msg.id, stub.id)
      await makeLidMap(prisma, { lid: stub.lid, pn })

      expect(await reconciliation.deduplicateIdentities()).toEqual({ merged: 1, skipped: 0 })

      expect(await prisma.identity.findUnique({ where: { id: stub.id } })).toBeNull()
      expect((await prisma.message.findUniqueOrThrow({ where: { id: msg.id } })).senderId).toBe(keep.id)
      expect(await prisma.chatMember.count({ where: { identityId: keep.id } })).toBe(1)
      expect(await prisma.identityAlias.findUnique({ where: { jid: stub.lid } })).toMatchObject({
        identityId: keep.id
      })
    })

    it('skips an uncorroborated common pushName and an ambiguous match', async () => {
      await makeContact(prisma, { pushName: 'Mom' })
      await makeStub('Mom')
      await makeContact(prisma, { pushName: 'Ann Lee' })
      await makeContact(prisma, { pushName: 'Ann Lee' })
      await makeStub('Ann Lee')

      expect(await reconciliation.deduplicateIdentities()).toEqual({ merged: 0, skipped: 2 })
    })
  })
})
