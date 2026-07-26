import { describe, it, expect, vi, beforeEach } from 'vitest'
import { KernelStorageModule, IKernelStorageRepository } from '../../../kernel/api-modules/KernelStorageModule'
import { IPermissionStore } from '../../../kernel/permissions/IPermissionStore'

describe('KernelStorageModule', () => {
  let mockPermissions: IPermissionStore
  let mockStorageRepo: IKernelStorageRepository
  let module: KernelStorageModule

  beforeEach(() => {
    mockPermissions = {
      hasCapability: vi.fn(),
      isResourceAllowed: vi.fn(),
      setCapability: vi.fn(),
      setScope: vi.fn(),
      getPluginPermissions: vi.fn()
    }

    mockStorageRepo = {
      get: vi.fn(),
      set: vi.fn(),
      delete: vi.fn(),
      clear: vi.fn(),
      keys: vi.fn()
    }

    module = new KernelStorageModule(mockPermissions, mockStorageRepo)
  })

  it('has correct namespace', () => {
    expect(module.namespace).toBe('kernel:storage')
  })

  it('denies get when storage:read capability is lacking', async () => {
    vi.mocked(mockPermissions.hasCapability).mockReturnValue(false)

    await expect(
      module.handle('plugin-a', 'kernel:storage:get', { key: 'my-key' })
    ).rejects.toEqual({
      code: 'PERMISSION_DENIED',
      message: "Plugin 'plugin-a' lacks capability 'storage:read'",
      permission: 'storage:read'
    })
  })

  it('allows get when storage:read is granted', async () => {
    vi.mocked(mockPermissions.hasCapability).mockReturnValue(true)
    vi.mocked(mockStorageRepo.get).mockResolvedValue(JSON.stringify({ value: 42 }))

    const result = await module.handle('plugin-a', 'kernel:storage:get', { key: 'my-key' })

    expect(mockStorageRepo.get).toHaveBeenCalledWith('plugin-a', 'my-key')
    expect(result).toEqual({ value: 42 })
  })

  it('denies set when storage:write is lacking', async () => {
    vi.mocked(mockPermissions.hasCapability).mockReturnValue(false)

    await expect(
      module.handle('plugin-a', 'kernel:storage:set', { key: 'my-key', value: 'data' })
    ).rejects.toEqual({
      code: 'PERMISSION_DENIED',
      message: "Plugin 'plugin-a' lacks capability 'storage:write'",
      permission: 'storage:write'
    })
  })

  it('allows set when storage:write is granted', async () => {
    vi.mocked(mockPermissions.hasCapability).mockReturnValue(true)

    const result = await module.handle('plugin-a', 'kernel:storage:set', { key: 'my-key', value: { hello: 'world' } })

    expect(mockStorageRepo.set).toHaveBeenCalledWith('plugin-a', 'my-key', JSON.stringify({ hello: 'world' }))
    expect(result).toEqual({ success: true })
  })

  it('allows keys when storage:read is granted', async () => {
    vi.mocked(mockPermissions.hasCapability).mockReturnValue(true)
    vi.mocked(mockStorageRepo.keys).mockResolvedValue(['k1', 'k2'])

    const result = await module.handle('plugin-a', 'kernel:storage:keys', {})

    expect(mockStorageRepo.keys).toHaveBeenCalledWith('plugin-a')
    expect(result).toEqual(['k1', 'k2'])
  })

  it('throws NOT_FOUND for unknown action type', async () => {
    await expect(
      module.handle('plugin-a', 'kernel:storage:unknown', {})
    ).rejects.toEqual({
      code: 'NOT_FOUND',
      message: "Unknown action 'kernel:storage:unknown' in module 'kernel:storage'"
    })
  })
})
