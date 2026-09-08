import { describe, it, expect, vi, beforeEach } from 'vitest'
import { join, resolve } from 'path'
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
      getPluginPermissions: vi.fn(),
      registerPluginManifest: vi.fn()
    }

    mockMessageQueryService = {
      getChatMessages: vi.fn(),
      getMessagesAroundId: vi.fn(),
      getOldestMessageKey: vi.fn(),
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
    ).rejects.toMatchObject({
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
    ).rejects.toMatchObject({
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

  it('allows downloadMedia and constructs filePath via injected getUserDataPath', async () => {
    const mockMediaService = {
      downloadAndCacheMedia: vi.fn().mockResolvedValue({
        id: 'msg-media-1',
        content: JSON.stringify({ audioMessage: { localURI: 'app://media/sample.ogg' } })
      })
    }

    const customModule = new KernelMessagesModule(
      mockPermissions,
      mockMessageQueryService,
      mockMessageActionService,
      () => ({ sendMessage: vi.fn() } as any),
      mockMediaService as any,
      () => '/mock/user/data'
    )

    vi.mocked(mockPermissions.hasCapability).mockReturnValue(true)

    const result = (await customModule.handle('plugin-a', 'kernel:messages:downloadMedia', {
      messageId: 'msg-media-1'
    })) as any

    expect(mockPermissions.hasCapability).toHaveBeenCalledWith('plugin-a', 'messages:read')
    expect(mockMediaService.downloadAndCacheMedia).toHaveBeenCalledWith('msg-media-1', expect.anything())
    expect(result.success).toBe(true)
    expect(result.localURI).toBe('app://media/sample.ogg')
    expect(result.filePath).toContain('sample.ogg')
    expect(result.filePath).toContain('user')
  })

  it('S7-06: downloadMedia contains a traversal-laden localURI under the media cache', async () => {
    const mockMediaService = {
      downloadAndCacheMedia: vi.fn().mockResolvedValue({
        id: 'msg-eviltrav',
        content: JSON.stringify({
          documentMessage: { localURI: 'app://media/../../../../etc/passwd' }
        })
      })
    }

    const customModule = new KernelMessagesModule(
      mockPermissions,
      mockMessageQueryService,
      mockMessageActionService,
      () => ({ sendMessage: vi.fn() } as any),
      mockMediaService as any,
      () => '/mock/user/data'
    )

    vi.mocked(mockPermissions.hasCapability).mockReturnValue(true)

    const result = (await customModule.handle('plugin-a', 'kernel:messages:downloadMedia', {
      messageId: 'msg-eviltrav'
    })) as any

    expect(result.filePath).not.toContain('..')
    expect(result.filePath).not.toContain('etc')
    // Either contained under <userData>/media, or rejected to null — never an escaped path.
    if (result.filePath) {
      expect(result.filePath).toContain('media')
      expect(result.filePath.endsWith('passwd')).toBe(true)
    }
  })

  it('returns null filePath when getUserDataPath is omitted in downloadMedia', async () => {
    const mockMediaService = {
      downloadAndCacheMedia: vi.fn().mockResolvedValue({
        id: 'msg-media-2',
        content: JSON.stringify({ imageMessage: { localURI: 'app://media/photo.jpg' } })
      })
    }

    const customModule = new KernelMessagesModule(
      mockPermissions,
      mockMessageQueryService,
      mockMessageActionService,
      () => ({ sendMessage: vi.fn() } as any),
      mockMediaService as any
    )

    vi.mocked(mockPermissions.hasCapability).mockReturnValue(true)

    const result = (await customModule.handle('plugin-a', 'kernel:messages:downloadMedia', {
      messageId: 'msg-media-2'
    })) as any

    expect(result.success).toBe(true)
    expect(result.localURI).toBe('app://media/photo.jpg')
    expect(result.filePath).toBeNull()
  })

  it('handles messages without localURI in downloadMedia', async () => {
    const mockMediaService = {
      downloadAndCacheMedia: vi.fn().mockResolvedValue({
        id: 'msg-media-3',
        content: JSON.stringify({ conversation: 'just text' })
      })
    }

    const customModule = new KernelMessagesModule(
      mockPermissions,
      mockMessageQueryService,
      mockMessageActionService,
      () => ({ sendMessage: vi.fn() } as any),
      mockMediaService as any,
      () => '/mock/user/data'
    )

    vi.mocked(mockPermissions.hasCapability).mockReturnValue(true)

    const result = (await customModule.handle('plugin-a', 'kernel:messages:downloadMedia', {
      messageId: 'msg-media-3'
    })) as any

    expect(result.success).toBe(true)
    expect(result.localURI).toBeUndefined()
    expect(result.filePath).toBeNull()
  })

  it('throws INTERNAL_ERROR when mediaService is missing in downloadMedia', async () => {
    vi.mocked(mockPermissions.hasCapability).mockReturnValue(true)

    await expect(
      module.handle('plugin-a', 'kernel:messages:downloadMedia', { messageId: 'msg-1' })
    ).rejects.toMatchObject({
      code: 'INTERNAL_ERROR',
      message: 'MediaService is not available in KernelMessagesModule'
    })
  })

  it('throws NOT_FOUND for unknown action type', async () => {
    await expect(
      module.handle('plugin-a', 'kernel:messages:unknownAction', {})
    ).rejects.toMatchObject({
      code: 'NOT_FOUND',
      message: "Unknown action 'kernel:messages:unknownAction' in module 'kernel:messages'"
    })
  })

  it('allows getMessagesAroundId when messages:read capability is granted', async () => {
    vi.mocked(mockPermissions.hasCapability).mockReturnValue(true)
    vi.mocked(mockPermissions.isResourceAllowed).mockReturnValue(true)
    vi.mocked(mockMessageQueryService.getMessagesAroundId).mockResolvedValue([
      { id: 'msg-10', chatJid: '123@s.whatsapp.net', textContent: 'Context message' } as any
    ])

    const result = await module.handle('plugin-a', 'kernel:messages:getMessagesAroundId', {
      jid: '123@s.whatsapp.net',
      messageId: 'msg-10',
      lookBehind: 10
    })

    expect(mockPermissions.hasCapability).toHaveBeenCalledWith('plugin-a', 'messages:read')
    expect(mockMessageQueryService.getMessagesAroundId).toHaveBeenCalledWith('123@s.whatsapp.net', 'msg-10', 10)
    expect(result).toEqual([{ id: 'msg-10', chatJid: '123@s.whatsapp.net', textContent: 'Context message' }])
  })

  it('allows sendMedia from the plugin extension dir when messages:send capability and scope are granted', async () => {
    const userData = '/mock/user/data'
    const safePath = join(userData, 'extensions', 'plugin-a', 'out.png')
    const customModule = new KernelMessagesModule(
      mockPermissions,
      mockMessageQueryService,
      mockMessageActionService,
      () => ({ sendMessage: vi.fn() } as any),
      undefined,
      () => userData
    )
    vi.mocked(mockPermissions.hasCapability).mockReturnValue(true)
    vi.mocked(mockPermissions.isResourceAllowed).mockReturnValue(true)
    vi.mocked(mockMessageActionService.sendMediaMessageWorkflow).mockResolvedValue({
      id: 'msg-media-1',
      chatJid: '123@s.whatsapp.net',
      textContent: 'Caption'
    } as any)

    const result = await customModule.handle('plugin-a', 'kernel:messages:sendMedia', {
      jid: '123@s.whatsapp.net',
      filePath: safePath,
      caption: 'Caption'
    })

    expect(mockPermissions.hasCapability).toHaveBeenCalledWith('plugin-a', 'messages:send')
    expect(mockMessageActionService.sendMediaMessageWorkflow).toHaveBeenCalledWith(
      expect.anything(),
      '123@s.whatsapp.net',
      resolve(safePath),
      'Caption',
      undefined,
      undefined
    )
    expect(result).toEqual({ id: 'msg-media-1', chatJid: '123@s.whatsapp.net', textContent: 'Caption' })
  })

  it('S7-02: sendMedia rejects a filePath outside the plugin sandbox / media cache', async () => {
    const customModule = new KernelMessagesModule(
      mockPermissions,
      mockMessageQueryService,
      mockMessageActionService,
      () => ({ sendMessage: vi.fn() } as any),
      undefined,
      () => '/mock/user/data'
    )
    vi.mocked(mockPermissions.hasCapability).mockReturnValue(true)
    vi.mocked(mockPermissions.isResourceAllowed).mockReturnValue(true)

    await expect(
      customModule.handle('plugin-a', 'kernel:messages:sendMedia', {
        jid: '123@s.whatsapp.net',
        filePath: '/etc/passwd'
      })
    ).rejects.toMatchObject({ code: 'PERMISSION_DENIED' })
    expect(mockMessageActionService.sendMediaMessageWorkflow).not.toHaveBeenCalled()
  })

  it('allows edit when messages:send capability is granted', async () => {
    vi.mocked(mockPermissions.hasCapability).mockReturnValue(true)
    vi.mocked(mockPermissions.isResourceAllowed).mockReturnValue(true)
    vi.mocked(mockMessageActionService.editMessage).mockResolvedValue({
      id: 'msg-1',
      textContent: 'Edited text'
    } as any)

    const result = await module.handle('plugin-a', 'kernel:messages:edit', {
      messageId: 'msg-1',
      newText: 'Edited text',
      jid: '123@s.whatsapp.net'
    })

    expect(mockPermissions.hasCapability).toHaveBeenCalledWith('plugin-a', 'messages:send')
    expect(mockMessageActionService.editMessage).toHaveBeenCalledWith(
      expect.anything(),
      'msg-1',
      'Edited text',
      '123@s.whatsapp.net'
    )
    expect(result).toEqual({ id: 'msg-1', textContent: 'Edited text' })
  })

  it('allows forward when messages:send capability is granted', async () => {
    vi.mocked(mockPermissions.hasCapability).mockReturnValue(true)
    vi.mocked(mockPermissions.isResourceAllowed).mockReturnValue(true)
    vi.mocked(mockMessageActionService.forwardMessage).mockResolvedValue({
      success: true,
      detail: 'Forwarded',
      results: [{ jid: '456@s.whatsapp.net', messageId: 'msg-fwd-1' }],
      failures: []
    })

    const result = await module.handle('plugin-a', 'kernel:messages:forward', {
      messageId: 'msg-1',
      targetJids: ['456@s.whatsapp.net']
    })

    expect(mockPermissions.hasCapability).toHaveBeenCalledWith('plugin-a', 'messages:send')
    expect(mockMessageActionService.forwardMessage).toHaveBeenCalledWith(
      expect.anything(),
      'msg-1',
      ['456@s.whatsapp.net'],
      undefined
    )
    expect(result).toEqual({
      success: true,
      detail: 'Forwarded',
      results: [{ jid: '456@s.whatsapp.net', messageId: 'msg-fwd-1' }],
      failures: []
    })
  })

  it('allows getReceipts when receiptService is provided', async () => {
    const mockReceiptService = {
      processMessageStatusUpdate: vi.fn(),
      processMessageReceipt: vi.fn(),
      getMessageReceipts: vi.fn().mockResolvedValue([{ userJid: 'user1', readTimestamp: 100 }])
    }

    const customModule = new KernelMessagesModule(
      mockPermissions,
      mockMessageQueryService,
      mockMessageActionService,
      () => ({ sendMessage: vi.fn() } as any),
      undefined,
      undefined,
      mockReceiptService as any
    )

    vi.mocked(mockPermissions.hasCapability).mockReturnValue(true)

    const result = await customModule.handle('plugin-a', 'kernel:messages:getReceipts', { messageId: 'msg-1' })

    expect(mockPermissions.hasCapability).toHaveBeenCalledWith('plugin-a', 'messages:read')
    expect(mockReceiptService.getMessageReceipts).toHaveBeenCalledWith('msg-1', null)
    expect(result).toEqual([{ userJid: 'user1', readTimestamp: 100 }])
  })

  it('allows addFavoriteSticker and getFavoriteStickers', async () => {
    const mockFavoriteStickerService = {
      addStickerToFavorites: vi.fn().mockResolvedValue(true),
      getFavoriteStickers: vi.fn().mockResolvedValue([{ id: 'st-1', fileName: 'cat.webp' }])
    }

    const customModule = new KernelMessagesModule(
      mockPermissions,
      mockMessageQueryService,
      mockMessageActionService,
      () => ({ sendMessage: vi.fn() } as any),
      undefined,
      undefined,
      undefined,
      mockFavoriteStickerService as any
    )

    vi.mocked(mockPermissions.hasCapability).mockReturnValue(true)

    const addRes = await customModule.handle('plugin-a', 'kernel:messages:addFavoriteSticker', { messageId: 'msg-1' })
    expect(mockPermissions.hasCapability).toHaveBeenCalledWith('plugin-a', 'messages:write')
    expect(mockFavoriteStickerService.addStickerToFavorites).toHaveBeenCalledWith('msg-1')
    expect(addRes).toEqual({ success: true })

    const listRes = await customModule.handle('plugin-a', 'kernel:messages:getFavoriteStickers', {})
    expect(mockPermissions.hasCapability).toHaveBeenCalledWith('plugin-a', 'messages:read')
    expect(mockFavoriteStickerService.getFavoriteStickers).toHaveBeenCalled()
    expect(listRes).toEqual([{ id: 'st-1', fileName: 'cat.webp' }])
  })

  describe('S7-01: message-id-only actions scope on the real owning chat', () => {
    const lookup = { findMessageById: vi.fn() }

    function moduleWithLookup() {
      return new KernelMessagesModule(
        mockPermissions,
        mockMessageQueryService,
        mockMessageActionService,
        () => ({ sendMessage: vi.fn() } as any),
        { downloadAndCacheMedia: vi.fn().mockResolvedValue({ id: 'm', content: '{}' }) } as any,
        () => '/data',
        { getMessageReceipts: vi.fn().mockResolvedValue([]) } as any,
        undefined,
        lookup
      )
    }

    beforeEach(() => {
      lookup.findMessageById.mockReset()
      vi.mocked(mockPermissions.hasCapability).mockReturnValue(true)
    })

    it('downloadMedia is denied for a message in a chat outside the plugin scope', async () => {
      lookup.findMessageById.mockResolvedValue({ chatJid: 'private@s.whatsapp.net' })
      vi.mocked(mockPermissions.isResourceAllowed).mockImplementation(
        (_p, _c, resource) => resource === 'allowed@s.whatsapp.net'
      )

      await expect(
        moduleWithLookup().handle('plugin-a', 'kernel:messages:downloadMedia', { messageId: 'msg-x' })
      ).rejects.toMatchObject({ code: 'PERMISSION_DENIED' })
      expect(mockPermissions.isResourceAllowed).toHaveBeenCalledWith(
        'plugin-a',
        'messages:read',
        'private@s.whatsapp.net'
      )
    })

    it('edit ignores a spoofed jid and scopes on the message\'s real chat', async () => {
      lookup.findMessageById.mockResolvedValue({ chatJid: 'private@s.whatsapp.net' })
      vi.mocked(mockPermissions.isResourceAllowed).mockImplementation(
        (_p, _c, resource) => resource === 'allowed@s.whatsapp.net'
      )

      await expect(
        moduleWithLookup().handle('plugin-a', 'kernel:messages:edit', {
          messageId: 'msg-x',
          newText: 'x',
          jid: 'allowed@s.whatsapp.net'
        })
      ).rejects.toMatchObject({ code: 'PERMISSION_DENIED' })
    })

    it('forward also enforces scope on every destination jid', async () => {
      lookup.findMessageById.mockResolvedValue({ chatJid: 'allowed@s.whatsapp.net' })
      vi.mocked(mockPermissions.isResourceAllowed).mockImplementation(
        (_p, _c, resource) => resource === 'allowed@s.whatsapp.net'
      )

      await expect(
        moduleWithLookup().handle('plugin-a', 'kernel:messages:forward', {
          messageId: 'msg-x',
          targetJids: ['allowed@s.whatsapp.net', 'stranger@s.whatsapp.net']
        })
      ).rejects.toMatchObject({ code: 'PERMISSION_DENIED' })
    })

    it('getReceipts is allowed when the message belongs to an allowed chat', async () => {
      lookup.findMessageById.mockResolvedValue({ chatJid: 'allowed@s.whatsapp.net' })
      vi.mocked(mockPermissions.isResourceAllowed).mockReturnValue(true)

      await expect(
        moduleWithLookup().handle('plugin-a', 'kernel:messages:getReceipts', { messageId: 'msg-x' })
      ).resolves.toEqual([])
    })

    it('throws NOT_FOUND when the message does not exist and no jid was given', async () => {
      lookup.findMessageById.mockResolvedValue(null)

      await expect(
        moduleWithLookup().handle('plugin-a', 'kernel:messages:downloadMedia', { messageId: 'ghost' })
      ).rejects.toMatchObject({ code: 'NOT_FOUND' })
    })
  })
})
