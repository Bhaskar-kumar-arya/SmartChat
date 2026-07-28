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
    vi.mocked(mockChatService.getChatList).mockResolvedValue([
      { jid: '123@s.whatsapp.net', name: 'Alice', unreadCount: 0, timestamp: 12345n } as any
    ])

    const result = await module.handle('plugin-a', 'kernel:chats:getList', { page: 1, limit: 10 })

    expect(mockChatService.getChatList).toHaveBeenCalledWith(1, 10)
    expect(result).toEqual([
      expect.objectContaining({ jid: '123@s.whatsapp.net', name: 'Alice' })
    ])
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

  it('throws NOT_FOUND for unknown action type', async () => {
    await expect(
      module.handle('plugin-a', 'kernel:chats:unknownAction', {})
    ).rejects.toMatchObject({
      code: 'NOT_FOUND',
      message: "Unknown action 'kernel:chats:unknownAction' in module 'kernel:chats'"
    })
  })
})
