import { describe, it, expect, vi, beforeEach } from 'vitest'
import { KernelContactsModule } from '../../../kernel/api-modules/KernelContactsModule'
import { IPermissionStore } from '../../../kernel/permissions/IPermissionStore'
import { IContactService } from '../../../services/contacts/IContactService'

describe('KernelContactsModule', () => {
  let mockPermissions: IPermissionStore
  let mockContactService: IContactService
  let module: KernelContactsModule

  beforeEach(() => {
    mockPermissions = {
      hasCapability: vi.fn(),
      isResourceAllowed: vi.fn(),
      setCapability: vi.fn(),
      setScope: vi.fn(),
      getPluginPermissions: vi.fn(),
      registerPluginManifest: vi.fn()
    }

    mockContactService = {
      getMeJids: vi.fn(),
      batchGetIdentityIds: vi.fn(),
      getIdentityIdByJid: vi.fn(),
      resolveLidFromJid: vi.fn(),
      findIdentityById: vi.fn(),
      getMePhoneNumberJid: vi.fn(),
      upsertContact: vi.fn(),
      linkLidAndPn: vi.fn(),
      registerMe: vi.fn(),
      batchResolveNames: vi.fn(),
      resolveName: vi.fn(),
      clearCaches: vi.fn(),
      warmLinkCache: vi.fn(),
      populateIdentityIdCache: vi.fn()
    }

    module = new KernelContactsModule(mockPermissions, mockContactService)
  })

  it('has correct namespace', () => {
    expect(module.namespace).toBe('kernel:contacts')
  })

  it('denies getByJid when contacts:read is lacking', async () => {
    vi.mocked(mockPermissions.hasCapability).mockReturnValue(false)

    await expect(
      module.handle('plugin-a', 'kernel:contacts:getByJid', { jid: '123@s.whatsapp.net' })
    ).rejects.toMatchObject({
      code: 'PERMISSION_DENIED',
      message: "Plugin 'plugin-a' lacks capability 'contacts:read'",
      permission: 'contacts:read'
    })
  })

  it('allows getByJid when contacts:read is granted', async () => {
    vi.mocked(mockPermissions.hasCapability).mockReturnValue(true)
    vi.mocked(mockPermissions.isResourceAllowed).mockReturnValue(true)
    vi.mocked(mockContactService.resolveName).mockResolvedValue('Alice Smith')

    const result = await module.handle('plugin-a', 'kernel:contacts:getByJid', { jid: '123@s.whatsapp.net' })

    expect(mockContactService.resolveName).toHaveBeenCalledWith('123@s.whatsapp.net', null)
    expect(result).toEqual({ jid: '123@s.whatsapp.net', name: 'Alice Smith' })
  })

  it('throws NOT_FOUND for unknown action type', async () => {
    await expect(
      module.handle('plugin-a', 'kernel:contacts:unknown', {})
    ).rejects.toMatchObject({
      code: 'NOT_FOUND',
      message: "Unknown action 'kernel:contacts:unknown' in module 'kernel:contacts'"
    })
  })
})
