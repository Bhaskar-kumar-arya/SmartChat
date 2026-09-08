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

  it('allows batchGetByJids when contacts:read is granted', async () => {
    vi.mocked(mockPermissions.hasCapability).mockReturnValue(true)
    vi.mocked(mockPermissions.isResourceAllowed).mockReturnValue(true)
    const map = new Map<string, string>([['123@s.whatsapp.net', 'Alice']])
    vi.mocked(mockContactService.batchResolveNames).mockResolvedValue(map)

    const result = await module.handle('plugin-a', 'kernel:contacts:batchGetByJids', {
      jids: ['123@s.whatsapp.net']
    })

    expect(mockPermissions.hasCapability).toHaveBeenCalledWith('plugin-a', 'contacts:read')
    expect(mockContactService.batchResolveNames).toHaveBeenCalledWith(['123@s.whatsapp.net'])
    expect(result).toEqual([{ jid: '123@s.whatsapp.net', name: 'Alice' }])
  })

  it('S7-01: batchGetByJids resolves only jids inside the plugin scope', async () => {
    vi.mocked(mockPermissions.hasCapability).mockReturnValue(true)
    vi.mocked(mockPermissions.isResourceAllowed).mockImplementation(
      (_p, _c, resource) => resource === 'allowed@s.whatsapp.net'
    )
    vi.mocked(mockContactService.batchResolveNames).mockResolvedValue(
      new Map<string, string>([['allowed@s.whatsapp.net', 'Alice']])
    )

    await module.handle('plugin-a', 'kernel:contacts:batchGetByJids', {
      jids: ['allowed@s.whatsapp.net', 'stranger@s.whatsapp.net']
    })

    expect(mockContactService.batchResolveNames).toHaveBeenCalledWith(['allowed@s.whatsapp.net'])
  })

  it('allows getMe when contacts:read is granted', async () => {
    vi.mocked(mockPermissions.hasCapability).mockReturnValue(true)
    vi.mocked(mockContactService.getMeJids).mockResolvedValue(['me@s.whatsapp.net'])
    vi.mocked(mockContactService.getMePhoneNumberJid).mockResolvedValue('15551234567@s.whatsapp.net')

    const result = await module.handle('plugin-a', 'kernel:contacts:getMe', {})

    expect(mockPermissions.hasCapability).toHaveBeenCalledWith('plugin-a', 'contacts:read')
    expect(result).toEqual({
      jids: ['me@s.whatsapp.net'],
      phoneNumberJid: '15551234567@s.whatsapp.net'
    })
  })

  it('allows upsertContact when contacts:write is granted', async () => {
    vi.mocked(mockPermissions.hasCapability).mockReturnValue(true)
    vi.mocked(mockPermissions.isResourceAllowed).mockReturnValue(true)
    vi.mocked(mockContactService.upsertContact).mockResolvedValue(undefined)

    const result = await module.handle('plugin-a', 'kernel:contacts:upsertContact', {
      contact: { id: '123@s.whatsapp.net', name: 'Alice' }
    })

    expect(mockPermissions.hasCapability).toHaveBeenCalledWith('plugin-a', 'contacts:write')
    expect(mockContactService.upsertContact).toHaveBeenCalledWith({ id: '123@s.whatsapp.net', name: 'Alice' })
    expect(result).toEqual({ success: true })
  })

  it('S7-07: rejects an id-less upsertContact instead of skipping the scope check', async () => {
    vi.mocked(mockPermissions.hasCapability).mockReturnValue(true)
    vi.mocked(mockPermissions.isResourceAllowed).mockReturnValue(true)

    await expect(
      module.handle('plugin-a', 'kernel:contacts:upsertContact', {
        contact: { name: 'Ghost', phoneNumber: '999@s.whatsapp.net' }
      })
    ).rejects.toMatchObject({ code: 'BAD_REQUEST' })
    expect(mockContactService.upsertContact).not.toHaveBeenCalled()
  })

  it('S7-07: scope-checks contact.lid / contact.phoneNumber aliases too', async () => {
    vi.mocked(mockPermissions.hasCapability).mockReturnValue(true)
    vi.mocked(mockPermissions.isResourceAllowed).mockImplementation(
      (_p, _c, resource) => resource === '123@s.whatsapp.net'
    )

    await expect(
      module.handle('plugin-a', 'kernel:contacts:upsertContact', {
        contact: { id: '123@s.whatsapp.net', lid: '77@lid', name: 'Alice' }
      })
    ).rejects.toMatchObject({ code: 'PERMISSION_DENIED', permission: 'contacts:write' })
    expect(mockContactService.upsertContact).not.toHaveBeenCalled()
  })

  it('allows resolveLid when contacts:read is granted', async () => {
    vi.mocked(mockPermissions.hasCapability).mockReturnValue(true)
    vi.mocked(mockPermissions.isResourceAllowed).mockReturnValue(true)
    vi.mocked(mockContactService.resolveLidFromJid).mockResolvedValue('123456@lid')

    const result = await module.handle('plugin-a', 'kernel:contacts:resolveLid', { jid: '123@s.whatsapp.net' })

    expect(mockPermissions.hasCapability).toHaveBeenCalledWith('plugin-a', 'contacts:read')
    expect(mockContactService.resolveLidFromJid).toHaveBeenCalledWith('123@s.whatsapp.net')
    expect(result).toEqual({ jid: '123@s.whatsapp.net', lid: '123456@lid' })
  })

  it('allows getAlias when aliasRepository is provided', async () => {
    const mockAliasRepo = {
      findIdentityAlias: vi.fn().mockResolvedValue({ id: 1, jid: '123@s.whatsapp.net', type: 'pn', identityId: 42 }),
      findLidAliasByIdentityId: vi.fn(),
      findAllAliases: vi.fn(),
      findIdentityAliases: vi.fn(),
      findIdentityAliasesMinimal: vi.fn(),
      upsertIdentityAlias: vi.fn()
    }

    const customModule = new KernelContactsModule(mockPermissions, mockContactService, mockAliasRepo as any)
    vi.mocked(mockPermissions.hasCapability).mockReturnValue(true)
    vi.mocked(mockPermissions.isResourceAllowed).mockReturnValue(true)

    const result = await customModule.handle('plugin-a', 'kernel:contacts:getAlias', { jid: '123@s.whatsapp.net' })

    expect(mockPermissions.hasCapability).toHaveBeenCalledWith('plugin-a', 'contacts:read')
    expect(mockAliasRepo.findIdentityAlias).toHaveBeenCalledWith('123@s.whatsapp.net')
    expect(result).toEqual({ id: 1, jid: '123@s.whatsapp.net', type: 'pn', identityId: 42 })
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
