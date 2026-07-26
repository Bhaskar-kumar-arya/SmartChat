import { describe, it, expect, vi, beforeEach } from 'vitest'
import { KernelMessagesModule } from '../../../kernel/api-modules/KernelMessagesModule'
import { IPermissionStore } from '../../../kernel/permissions/IPermissionStore'
import { IMessageQueryService } from '../../../services/messages/IMessageQueryService'
import { IMessageActionService } from '../../../services/messages/IMessageActionService'

describe('KernelMessagesModule', () => {
  let mockPermissions: IPermissionStore
  let mockMessageQueryService: IMessageQueryService
  let mockMessageActionService: IMessageActionService
  let module: KernelMessagesModule

  beforeEach(() => {
    mockPermissions = {
      hasCapability: vi.fn(),
      isResourceAllowed: vi.fn(),
      setCapability: vi.fn(),
      setScope: vi.fn(),
      getPluginPermissions: vi.fn()
    }

    mockMessageQueryService = {
      getChatMessages: vi.fn(),
      getMessagesAroundId: vi.fn(),
      enrichMessage: vi.fn(),
      enrichSingleMessage: vi.fn()
    }

    mockMessageActionService = {
      deleteMessage: vi.fn(),
      editMessage: vi.fn(),
      forwardMessage: vi.fn(),
      reactToMessage: vi.fn(),
      sendMessageWorkflow: vi.fn(),
      sendMediaMessageWorkflow: vi.fn()
    }

    module = new KernelMessagesModule(
      mockPermissions,
      mockMessageQueryService,
      mockMessageActionService,
      () => ({ sendMessage: vi.fn() } as any)
    )
  })

  it('has correct namespace', () => {
    expect(module.namespace).toBe('kernel:messages')
  })

  it('denies getMessages when plugin lacks messages:read capability', async () => {
    vi.mocked(mockPermissions.hasCapability).mockReturnValue(false)

    await expect(
      module.handle('plugin-a', 'kernel:messages:getMessages', { jid: '123@s.whatsapp.net', page: 1, limit: 20 })
    ).rejects.toEqual({
      code: 'PERMISSION_DENIED',
      message: "Plugin 'plugin-a' lacks capability 'messages:read'",
      permission: 'messages:read'
    })
  })

  it('allows send when messages:send capability and scope are valid', async () => {
    vi.mocked(mockPermissions.hasCapability).mockReturnValue(true)
    vi.mocked(mockPermissions.isResourceAllowed).mockReturnValue(true)
    vi.mocked(mockMessageActionService.sendMessageWorkflow).mockResolvedValue({
      id: 'msg-1',
      chatJid: '123@s.whatsapp.net',
      textContent: 'Hello'
    } as any)

    const result = await module.handle('plugin-a', 'kernel:messages:send', {
      jid: '123@s.whatsapp.net',
      text: 'Hello'
    })

    expect(mockPermissions.hasCapability).toHaveBeenCalledWith('plugin-a', 'messages:send')
    expect(mockMessageActionService.sendMessageWorkflow).toHaveBeenCalledWith(
      expect.anything(),
      '123@s.whatsapp.net',
      'Hello',
      undefined,
      undefined
    )
    expect(result).toEqual(expect.objectContaining({ id: 'msg-1', textContent: 'Hello' }))
  })

  it('denies delete when plugin lacks messages:delete capability', async () => {
    vi.mocked(mockPermissions.hasCapability).mockReturnValue(false)

    await expect(
      module.handle('plugin-a', 'kernel:messages:delete', { jid: '123@s.whatsapp.net', messageId: 'msg-1' })
    ).rejects.toEqual({
      code: 'PERMISSION_DENIED',
      message: "Plugin 'plugin-a' lacks capability 'messages:delete'",
      permission: 'messages:delete'
    })
  })

  it('allows react when messages:send is granted', async () => {
    vi.mocked(mockPermissions.hasCapability).mockReturnValue(true)
    vi.mocked(mockPermissions.isResourceAllowed).mockReturnValue(true)
    vi.mocked(mockMessageActionService.reactToMessage).mockResolvedValue({
      success: true,
      detail: 'reacted',
      messageId: 'msg-1',
      reaction: '👍'
    })

    const result = await module.handle('plugin-a', 'kernel:messages:react', {
      jid: '123@s.whatsapp.net',
      messageId: 'msg-1',
      emoji: '👍'
    })

    expect(mockPermissions.hasCapability).toHaveBeenCalledWith('plugin-a', 'messages:send')
    expect(mockMessageActionService.reactToMessage).toHaveBeenCalledWith(
      expect.anything(),
      'msg-1',
      '👍',
      '123@s.whatsapp.net'
    )
    expect(result).toEqual({ success: true, detail: 'reacted', messageId: 'msg-1', reaction: '👍' })
  })

  it('throws NOT_FOUND for unknown action type', async () => {
    await expect(
      module.handle('plugin-a', 'kernel:messages:unknownAction', {})
    ).rejects.toEqual({
      code: 'NOT_FOUND',
      message: "Unknown action 'kernel:messages:unknownAction' in module 'kernel:messages'"
    })
  })
})
