import { describe, it, expect, vi, beforeEach } from 'vitest'
import { KernelChatsModule } from '../../../kernel/api-modules/KernelChatsModule'
import { IPermissionStore } from '../../../kernel/permissions/IPermissionStore'
import { IChatService } from '../../../services/chats/IChatService'
import { IChatActionService } from '../../../services/chats/IChatActionService'

describe('KernelChatsModule', () => {
  let mockPermissions: IPermissionStore
  let mockChatService: IChatService
  let mockChatActionService: IChatActionService
  let module: KernelChatsModule

  beforeEach(() => {
    mockPermissions = {
      hasCapability: vi.fn(),
      isResourceAllowed: vi.fn(),
      setCapability: vi.fn(),
      setScope: vi.fn(),
      getPluginPermissions: vi.fn(),
      registerPluginManifest: vi.fn()
    }

    mockChatService = {
      getChatList: vi.fn(),
      getChatByJid: vi.fn(),
      isChatMuted: vi.fn(),
      upsertChat: vi.fn(),
      markRead: vi.fn(),
      incrementUnread: vi.fn(),
      updateTimestamp: vi.fn(),
      getGroupParticipants: vi.fn()
    }

    mockChatActionService = {
      muteChat: vi.fn(),
      pinChat: vi.fn(),
      markChatRead: vi.fn(),
      archiveChat: vi.fn()
    }

    module = new KernelChatsModule(
      mockPermissions,
      mockChatService,
      mockChatActionService,
      () => ({ chatModify: vi.fn() } as any)
    )
  })

  it('has correct namespace', () => {
    expect(module.namespace).toBe('kernel:chats')
  })

  it('denies getList when plugin lacks chats:read capability', async () => {
    vi.mocked(mockPermissions.hasCapability).mockReturnValue(false)

    await expect(
      module.handle('plugin-a', 'kernel:chats:getList', { page: 1, limit: 10 })
    ).rejects.toMatchObject({
      code: 'PERMISSION_DENIED',
      message: "Plugin 'plugin-a' lacks capability 'chats:read'",
      permission: 'chats:read'
    })
  })

  it('allows getList when chats:read capability is granted', async () => {
    vi.mocked(mockPermissions.hasCapability).mockReturnValue(true)
    vi.mocked(mockPermissions.isResourceAllowed).mockReturnValue(true)
    vi.mocked(mockChatService.getChatList).mockResolvedValue([
      { jid: '123@s.whatsapp.net', name: 'Alice', unreadCount: 0, timestamp: 12345n } as any
    ])

    const result = await module.handle('plugin-a', 'kernel:chats:getList', { page: 1, limit: 10 })

    expect(mockChatService.getChatList).toHaveBeenCalledWith(1, 10)
    expect(result).toEqual([
      expect.objectContaining({ jid: '123@s.whatsapp.net', name: 'Alice' })
    ])
  })

  it('S7-01: getList filters out chats outside the plugin scope', async () => {
    vi.mocked(mockPermissions.hasCapability).mockReturnValue(true)
    vi.mocked(mockPermissions.isResourceAllowed).mockImplementation(
      (_p, _c, resource) => resource === 'allowed@s.whatsapp.net'
    )
    vi.mocked(mockChatService.getChatList).mockResolvedValue([
      { jid: 'allowed@s.whatsapp.net', name: 'Alice' } as any,
      { jid: 'secret@s.whatsapp.net', name: 'Secret' } as any
    ])

    const result = (await module.handle('plugin-a', 'kernel:chats:getList', {})) as any[]

    expect(result.map((c) => c.jid)).toEqual(['allowed@s.whatsapp.net'])
  })

  it('denies getById when resource is not allowed', async () => {
    vi.mocked(mockPermissions.hasCapability).mockReturnValue(true)
    vi.mocked(mockPermissions.isResourceAllowed).mockReturnValue(false)

    await expect(
      module.handle('plugin-a', 'kernel:chats:getById', { jid: 'blocked@s.whatsapp.net' })
    ).rejects.toMatchObject({
      code: 'PERMISSION_DENIED',
      message: "Plugin 'plugin-a' is denied access to resource 'blocked@s.whatsapp.net' for capability 'chats:read'",
      permission: 'chats:read'
    })
  })

  it('allows getById when resource is allowed', async () => {
    vi.mocked(mockPermissions.hasCapability).mockReturnValue(true)
    vi.mocked(mockPermissions.isResourceAllowed).mockReturnValue(true)
    vi.mocked(mockChatService.getChatByJid).mockResolvedValue({
      jid: 'allowed@s.whatsapp.net',
      name: 'Bob'
    } as any)

    const result = await module.handle('plugin-a', 'kernel:chats:getById', { jid: 'allowed@s.whatsapp.net' })

    expect(mockChatService.getChatByJid).toHaveBeenCalledWith('allowed@s.whatsapp.net')
    expect(result).toEqual({ jid: 'allowed@s.whatsapp.net', name: 'Bob' })
  })

  it('delegates pin action with chats:write permission', async () => {
    vi.mocked(mockPermissions.hasCapability).mockReturnValue(true)
    vi.mocked(mockPermissions.isResourceAllowed).mockReturnValue(true)
    vi.mocked(mockChatActionService.pinChat).mockResolvedValue({ success: true, detail: 'pinned' })

    const result = await module.handle('plugin-a', 'kernel:chats:pin', { jid: '123@s.whatsapp.net' })

    expect(mockPermissions.hasCapability).toHaveBeenCalledWith('plugin-a', 'chats:write')
    expect(mockChatActionService.pinChat).toHaveBeenCalledWith(expect.anything(), '123@s.whatsapp.net', true)
    expect(result).toEqual({ success: true, detail: 'pinned' })
  })

  it('allows getGroupParticipants when chats:read capability and scope are granted', async () => {
    vi.mocked(mockPermissions.hasCapability).mockReturnValue(true)
    vi.mocked(mockPermissions.isResourceAllowed).mockReturnValue(true)
    vi.mocked(mockChatService.getGroupParticipants).mockResolvedValue([
      { jid: '123@s.whatsapp.net', name: 'Alice', isAdmin: true, isMe: false }
    ])

    const result = await module.handle('plugin-a', 'kernel:chats:getGroupParticipants', {
      jid: 'group123@g.us'
    })

    expect(mockPermissions.hasCapability).toHaveBeenCalledWith('plugin-a', 'chats:read')
    expect(mockPermissions.isResourceAllowed).toHaveBeenCalledWith('plugin-a', 'chats:read', 'group123@g.us')
    expect(mockChatService.getGroupParticipants).toHaveBeenCalledWith('group123@g.us')
    expect(result).toEqual([{ jid: '123@s.whatsapp.net', name: 'Alice', isAdmin: true, isMe: false }])
  })

  it('S7-05: getList walks source pages so a scoped plugin sees a stable filtered page', async () => {
    vi.mocked(mockPermissions.hasCapability).mockReturnValue(true)
    // Only chats on later DB pages are allowed.
    vi.mocked(mockPermissions.isResourceAllowed).mockImplementation(
      (_p, _c, resource) => String(resource).startsWith('ok')
    )
    vi.mocked(mockChatService.getChatList).mockImplementation(async (page = 1, size = 50) => {
      // 3 source pages of `size` rows; allowed chats only on page 3.
      if (page === 1) return Array.from({ length: size }, (_, i) => ({ jid: `no1-${i}@s.whatsapp.net`, name: 'x' })) as any
      if (page === 2) return Array.from({ length: size }, (_, i) => ({ jid: `no2-${i}@s.whatsapp.net`, name: 'x' })) as any
      if (page === 3) return [{ jid: 'ok-a@s.whatsapp.net', name: 'A' }, { jid: 'ok-b@s.whatsapp.net', name: 'B' }] as any
      return []
    })

    const result = (await module.handle('plugin-a', 'kernel:chats:getList', { page: 1, limit: 50 })) as any[]

    // The empty page-1 DB slice must NOT be reported as the end of the list.
    expect(result.map((c) => c.jid)).toEqual(['ok-a@s.whatsapp.net', 'ok-b@s.whatsapp.net'])
  })

  it('throws NOT_FOUND for unknown action type', async () => {
    await expect(
      module.handle('plugin-a', 'kernel:chats:unknownAction', {})
    ).rejects.toMatchObject({
      code: 'NOT_FOUND',
      message: "Unknown action 'kernel:chats:unknownAction' in module 'kernel:chats'"
    })
  })
})
