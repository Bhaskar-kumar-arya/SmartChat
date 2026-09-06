import { describe, it, expect, vi, beforeEach } from 'vitest'
import { IdentityReconciliationService } from '../../services/contacts/IdentityReconciliationService'
import { IContactMutationService } from '../../services/contacts/IContactService'
import { PrismaClient } from '@prisma/client'

describe('IdentityReconciliationService', () => {
  let service: IdentityReconciliationService
  let prisma: any // Mocked PrismaClient
  let contactService: import('vitest').Mocked<IContactMutationService>

  beforeEach(() => {
    prisma = {
      identity: {
        findMany: vi.fn(),
        update: vi.fn(),
        delete: vi.fn(),
      },
      identityAlias: {
        updateMany: vi.fn(),
      },
      message: {
        updateMany: vi.fn(),
      },
      chatMember: {
        findMany: vi.fn(),
        findUnique: vi.fn(),
        update: vi.fn(),
        delete: vi.fn(),
      },
      reaction: {
        findMany: vi.fn(),
        findUnique: vi.fn(),
        update: vi.fn(),
        delete: vi.fn(),
      }
    }
    // Interactive transaction: run the callback against the same mock client.
    prisma.$transaction = vi.fn((arg: any) =>
      typeof arg === 'function' ? arg(prisma) : Promise.all(arg)
    )

    contactService = {
      linkLidAndPn: vi.fn(),
      batchGetIdentityIds: vi.fn(),
      getIdentityIdByJid: vi.fn(),
      upsertContact: vi.fn(),
      registerMe: vi.fn(),
    } as any

    service = new IdentityReconciliationService(prisma as PrismaClient, contactService)
  })

  it('deduplicateIdentities does nothing if no stubs are found', async () => {
    prisma.identity.findMany.mockResolvedValue([])
    const result = await service.deduplicateIdentities()
    expect(result).toEqual({ merged: 0, skipped: 0 })
  })

  it('deduplicateIdentities runs the stub merge inside a single interactive transaction', async () => {
    prisma.identity.findMany
      .mockResolvedValueOnce([
        { id: 1, pushName: 'Alice', displayName: null, verifiedName: null, profilePictureUrl: null, aliases: [] },
      ])
      .mockResolvedValueOnce([{ id: 2, pushName: 'Alice', phoneNumber: '123', displayName: 'Alice' }])
    prisma.identityAlias.updateMany.mockResolvedValue({ count: 1 })
    prisma.message.updateMany.mockResolvedValue({ count: 0 })
    prisma.chatMember.findMany.mockResolvedValue([])
    prisma.reaction.findMany.mockResolvedValue([])
    prisma.identity.delete.mockResolvedValue({})

    const result = await service.deduplicateIdentities()

    expect(prisma.$transaction).toHaveBeenCalledTimes(1)
    expect(prisma.identity.delete).toHaveBeenCalledWith({ where: { id: 1 } })
    expect(result).toEqual({ merged: 1, skipped: 0 })
  })

  it('deduplicateIdentities does not delete the stub if an earlier merge step fails (tx rolls back)', async () => {
    prisma.identity.findMany
      .mockResolvedValueOnce([
        { id: 1, pushName: 'Bob', displayName: null, verifiedName: null, profilePictureUrl: null, aliases: [] },
      ])
      .mockResolvedValueOnce([{ id: 2, pushName: 'Bob', phoneNumber: '999', displayName: 'Bob' }])
    prisma.identityAlias.updateMany.mockResolvedValue({ count: 1 })
    prisma.message.updateMany.mockRejectedValue(new Error('DB locked'))

    const result = await service.deduplicateIdentities()

    expect(prisma.identity.delete).not.toHaveBeenCalled()
    expect(result).toEqual({ merged: 0, skipped: 1 })
  })

  it('reconcileLidPnFromJids links LID and PN when both are present', async () => {
    contactService.linkLidAndPn.mockResolvedValue(undefined)
    await service.reconcileLidPnFromJids(['123@s.whatsapp.net', '456@lid', null], 'test')
    expect(contactService.linkLidAndPn).toHaveBeenCalledWith('456@lid', '123@s.whatsapp.net', 'test')
  })

  it('reconcileLidPnFromJids does nothing if only one is present', async () => {
    await service.reconcileLidPnFromJids(['123@s.whatsapp.net'], 'test')
    expect(contactService.linkLidAndPn).not.toHaveBeenCalled()
  })
})
