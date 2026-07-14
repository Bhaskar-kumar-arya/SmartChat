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
