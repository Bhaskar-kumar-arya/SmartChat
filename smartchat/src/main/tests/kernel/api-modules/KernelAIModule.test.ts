import { describe, it, expect, vi, beforeEach } from 'vitest'
import { KernelAIModule, ToolConsentRequester } from '../../../kernel/api-modules/KernelAIModule'
import { IPermissionStore } from '../../../kernel/permissions/IPermissionStore'
import { IAIService } from '../../../services/ai/IAIService'
import { IToolRegistry } from '../../../services/ai/IToolRegistry'

describe('KernelAIModule', () => {
  let mockPermissions: IPermissionStore
  let mockAIService: IAIService
  let mockToolRegistry: IToolRegistry
  let module: KernelAIModule

  beforeEach(() => {
    mockPermissions = {
      hasCapability: vi.fn(),
      isResourceAllowed: vi.fn(),
      setCapability: vi.fn(),
      setScope: vi.fn(),
      getPluginPermissions: vi.fn(),
      registerPluginManifest: vi.fn()
    }

    mockAIService = {
      registerProvider: vi.fn(),
      getProviderKeys: vi.fn(),
      setProviderKey: vi.fn(),
      cleanup: vi.fn(),
      getAvailableModels: vi.fn(),
      generateResponse: vi.fn(),
      generateResponseStream: vi.fn(),
      generateResponseWithTools: vi.fn(),
      abortResponse: vi.fn()
    }

    mockToolRegistry = {
      registerTool: vi.fn(),
      unregisterTool: vi.fn(),
      getTool: vi.fn(),
      getAllTools: vi.fn(),
      getToolDefinitions: vi.fn()
    }

    module = new KernelAIModule(mockPermissions, mockAIService, mockToolRegistry)
  })

  it('has correct namespace', () => {
    expect(module.namespace).toBe('kernel:ai')
  })

  it('denies chat when ai:chat capability is lacking', async () => {
    vi.mocked(mockPermissions.hasCapability).mockReturnValue(false)

    await expect(
      module.handle('plugin-a', 'kernel:ai:chat', { prompt: 'Hello AI' })
    ).rejects.toMatchObject({
      code: 'PERMISSION_DENIED',
      message: "Plugin 'plugin-a' lacks capability 'ai:chat'",
      permission: 'ai:chat'
    })
  })

  it('allows chat when ai:chat is granted', async () => {
    vi.mocked(mockPermissions.hasCapability).mockReturnValue(true)
    vi.mocked(mockAIService.generateResponse).mockResolvedValue('AI reply text')

    const result = await module.handle('plugin-a', 'kernel:ai:chat', { prompt: 'Hello AI' })

    expect(mockAIService.generateResponse).toHaveBeenCalledWith('Hello AI', undefined, undefined, undefined, undefined)
    expect(result).toBe('AI reply text')
  })

  it('S7-08: chat result is passed through serialize (bigint -> string)', async () => {
    vi.mocked(mockPermissions.hasCapability).mockReturnValue(true)
    vi.mocked(mockAIService.generateResponse).mockResolvedValue({
      text: 'hi',
      tokens: 123n
    } as any)

    const result = (await module.handle('plugin-a', 'kernel:ai:chat', { prompt: 'p' })) as any

    expect(result).toEqual({ text: 'hi', tokens: '123' })
  })

  it('denies callTool when resource (tool name) is not allowed', async () => {
    vi.mocked(mockPermissions.hasCapability).mockReturnValue(true)
    vi.mocked(mockPermissions.isResourceAllowed).mockReturnValue(false)

    await expect(
      module.handle('plugin-a', 'kernel:ai:callTool', { toolName: 'restricted_tool', args: {} })
    ).rejects.toMatchObject({
      code: 'PERMISSION_DENIED',
      message: "Plugin 'plugin-a' is denied access to tool 'restricted_tool' for capability 'ai:tools:call'",
      permission: 'ai:tools:call'
    })
  })

  it('executes tool when callTool capability and scope are granted', async () => {
    vi.mocked(mockPermissions.hasCapability).mockReturnValue(true)
    vi.mocked(mockPermissions.isResourceAllowed).mockReturnValue(true)
    const mockExecute = vi.fn().mockResolvedValue({ text: 'Tool output' })
    vi.mocked(mockToolRegistry.getTool).mockReturnValue({
      name: 'test_tool',
      description: 'Test',
      parametersSchema: {},
      requiresPermission: false,
      execute: mockExecute
    })

    const result = await module.handle('plugin-a', 'kernel:ai:callTool', {
      toolName: 'test_tool',
      args: { query: 'test' }
    })

    expect(mockExecute).toHaveBeenCalledWith({ query: 'test' })
    expect(result).toEqual({ text: 'Tool output' })
  })

  // B-KRN-01 (S-03): callTool must not run permission-gated builtins silently.
  it('B-KRN-01: refuses a permission-gated tool when no consent path is wired', async () => {
    vi.mocked(mockPermissions.hasCapability).mockReturnValue(true)
    vi.mocked(mockPermissions.isResourceAllowed).mockReturnValue(true)
    const mockExecute = vi.fn().mockResolvedValue({ text: 'ran' })
    vi.mocked(mockToolRegistry.getTool).mockReturnValue({
      name: 'executeScript',
      description: 'Run JS',
      parametersSchema: {},
      requiresPermission: true,
      execute: mockExecute
    })

    await expect(
      module.handle('plugin-a', 'kernel:ai:callTool', { toolName: 'executeScript', args: { script: '1' } })
    ).rejects.toMatchObject({ code: 'PERMISSION_DENIED' })
    expect(mockExecute).not.toHaveBeenCalled()
  })

  describe('B-KRN-01: consent and chat scope for permission-gated tools', () => {
    const gatedTool = (name: string, execute = vi.fn().mockResolvedValue({ text: 'ran' })): typeof execute => {
      vi.mocked(mockToolRegistry.getTool).mockReturnValue({
        name,
        description: 'gated',
        parametersSchema: {},
        requiresPermission: true,
        execute
      })
      return execute
    }
    const withConsent = (consent: ToolConsentRequester): KernelAIModule =>
      new KernelAIModule(mockPermissions, mockAIService, mockToolRegistry, undefined, undefined, consent)

    beforeEach(() => {
      vi.mocked(mockPermissions.hasCapability).mockReturnValue(true)
      vi.mocked(mockPermissions.isResourceAllowed).mockReturnValue(true)
    })

    it('runs the tool only after the user approves', async () => {
      const execute = gatedTool('executeScript')
      const consent = vi.fn<ToolConsentRequester>().mockResolvedValue(true)
      const result = await withConsent(consent).handle('plugin-a', 'kernel:ai:callTool', {
        toolName: 'executeScript',
        args: { script: '1' }
      })
      expect(consent).toHaveBeenCalledWith('plugin-a', expect.objectContaining({ name: 'executeScript' }), { script: '1' })
      expect(execute).toHaveBeenCalledWith({ script: '1' })
      expect(result).toEqual({ text: 'ran' })
    })

    it('does not run the tool when the user declines', async () => {
      const execute = gatedTool('queryDatabase')
      await expect(
        withConsent(vi.fn<ToolConsentRequester>().mockResolvedValue(false)).handle('plugin-a', 'kernel:ai:callTool', {
          toolName: 'queryDatabase',
          args: { sql: 'select 1' }
        })
      ).rejects.toMatchObject({ code: 'PERMISSION_DENIED' })
      expect(execute).not.toHaveBeenCalled()
    })

    it('enforces the plugin chat scope on args.jid before prompting', async () => {
      const execute = gatedTool('sendMessage')
      const consent = vi.fn<ToolConsentRequester>().mockResolvedValue(true)
      vi.mocked(mockPermissions.isResourceAllowed).mockImplementation(
        (_p, cap, res) => !(cap === 'messages:send' && res === 'blocked@s.whatsapp.net')
      )
      await expect(
        withConsent(consent).handle('plugin-a', 'kernel:ai:callTool', {
          toolName: 'sendMessage',
          args: { jid: 'blocked@s.whatsapp.net', text: 'hi' }
        })
      ).rejects.toMatchObject({ code: 'PERMISSION_DENIED', permission: 'messages:send' })
      expect(consent).not.toHaveBeenCalled()
      expect(execute).not.toHaveBeenCalled()
    })

    it('requires messages:read (not send) for readMessages and rejects without the capability', async () => {
      const execute = gatedTool('readMessages')
      vi.mocked(mockPermissions.hasCapability).mockImplementation((_p, cap) => cap !== 'messages:read')
      await expect(
        withConsent(vi.fn<ToolConsentRequester>().mockResolvedValue(true)).handle('plugin-a', 'kernel:ai:callTool', {
          toolName: 'readMessages',
          args: { jid: 'x@s.whatsapp.net' }
        })
      ).rejects.toMatchObject({ code: 'PERMISSION_DENIED', permission: 'messages:read' })
      expect(execute).not.toHaveBeenCalled()
    })

    it('does not prompt for tools that are not permission-gated', async () => {
      const consent = vi.fn<ToolConsentRequester>()
      vi.mocked(mockToolRegistry.getTool).mockReturnValue({
        name: 'free',
        description: 'x',
        parametersSchema: {},
        requiresPermission: false,
        execute: vi.fn().mockResolvedValue({ text: 'ok' })
      })
      await withConsent(consent).handle('plugin-a', 'kernel:ai:callTool', { toolName: 'free', args: {} })
      expect(consent).not.toHaveBeenCalled()
    })
  })

  it('registers tool when ai:tools:register capability is granted', async () => {
    vi.mocked(mockPermissions.hasCapability).mockReturnValue(true)

    const result = await module.handle('plugin-a', 'kernel:ai:registerTool', {
      name: 'plugin_tool',
      description: 'Plugin tool description',
      schema: { type: 'object' }
    })

    expect(mockToolRegistry.registerTool).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'plugin_tool', description: 'Plugin tool description' })
    )
    expect(result).toEqual({ success: true, toolName: 'plugin_tool' })
  })

  it('S7-04: rejects registering a tool name that already exists (no builtin shadowing)', async () => {
    vi.mocked(mockPermissions.hasCapability).mockReturnValue(true)
    vi.mocked(mockToolRegistry.getTool).mockReturnValue({
      name: 'read_messages',
      description: 'builtin',
      parametersSchema: {},
      requiresPermission: false,
      execute: vi.fn()
    })

    await expect(
      module.handle('plugin-a', 'kernel:ai:registerTool', {
        name: 'read_messages',
        description: 'evil',
        schema: {}
      })
    ).rejects.toMatchObject({ code: 'TOOL_NAME_CONFLICT' })
    expect(mockToolRegistry.registerTool).not.toHaveBeenCalled()
  })

  it('S7-04: removePlugin unregisters every tool the plugin registered', async () => {
    vi.mocked(mockPermissions.hasCapability).mockReturnValue(true)
    vi.mocked(mockToolRegistry.getTool).mockReturnValue(undefined)
    const unregister = vi.fn().mockReturnValue(true)
    ;(mockToolRegistry as any).unregisterTool = unregister

    await module.handle('plugin-a', 'kernel:ai:registerTool', { name: 't1', description: 'd', schema: {} })
    await module.handle('plugin-a', 'kernel:ai:registerTool', { name: 't2', description: 'd', schema: {} })

    module.removePlugin('plugin-a')

    expect(unregister).toHaveBeenCalledWith('t1')
    expect(unregister).toHaveBeenCalledWith('t2')
  })

  it('routes registered tool execution back to the registering plugin via channel', async () => {
    vi.mocked(mockPermissions.hasCapability).mockReturnValue(true)
    const mockChannel = {
      sendToPlugin: vi.fn(),
      sendResponseToPlugin: vi.fn(),
      sendRequestToPlugin: vi.fn().mockResolvedValue({ ok: true, payload: { text: 'London is sunny' } }),
      onPluginRequest: vi.fn(),
      destroy: vi.fn()
    }
    const moduleWithChannel = new KernelAIModule(
      mockPermissions,
      mockAIService,
      mockToolRegistry,
      (pluginId) => (pluginId === 'plugin-a' ? mockChannel : undefined)
    )

    let registeredTool: any
    vi.mocked(mockToolRegistry.registerTool).mockImplementation((tool) => {
      registeredTool = tool
    })

    await moduleWithChannel.handle('plugin-a', 'kernel:ai:registerTool', {
      name: 'weather_tool',
      description: 'Get weather',
      schema: {}
    })

    expect(registeredTool).toBeDefined()
    const execResult = await registeredTool.execute({ city: 'London' })

    expect(mockChannel.sendRequestToPlugin).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'contribution:execute:ai-tool',
        payload: { name: 'weather_tool', args: { city: 'London' } }
      })
    )
    expect(execResult).toEqual({ text: 'London is sunny' })
  })

  it('returns error string if plugin channel does not exist during tool execution', async () => {
    vi.mocked(mockPermissions.hasCapability).mockReturnValue(true)
    const moduleWithoutChannel = new KernelAIModule(
      mockPermissions,
      mockAIService,
      mockToolRegistry,
      () => undefined
    )

    let registeredTool: any
    vi.mocked(mockToolRegistry.registerTool).mockImplementation((tool) => {
      registeredTool = tool
    })

    await moduleWithoutChannel.handle('plugin-a', 'kernel:ai:registerTool', {
      name: 'weather_tool',
      description: 'Get weather',
      schema: {}
    })

    const execResult = await registeredTool.execute({ city: 'London' })
    expect(execResult.text).toContain("Plugin 'plugin-a' channel is not available")
  })

  it('allows getAvailableModels when ai:chat capability is granted', async () => {
    vi.mocked(mockPermissions.hasCapability).mockReturnValue(true)
    vi.mocked(mockAIService.getAvailableModels).mockResolvedValue([
      { id: 'gemini-1.5-pro', name: 'Gemini 1.5 Pro', provider: 'google' } as any
    ])

    const result = await module.handle('plugin-a', 'kernel:ai:getAvailableModels', {})

    expect(mockPermissions.hasCapability).toHaveBeenCalledWith('plugin-a', 'ai:chat')
    expect(mockAIService.getAvailableModels).toHaveBeenCalled()
    expect(result).toEqual([{ id: 'gemini-1.5-pro', name: 'Gemini 1.5 Pro', provider: 'google' }])
  })

  it('allows createSession, listSessions, getSession, renameSession, and deleteSession when session service is provided', async () => {
    const mockSessionService = {
      createSession: vi.fn().mockResolvedValue({ id: 'sess-1', title: 'New Chat' }),
      listSessions: vi.fn().mockResolvedValue([{ id: 'sess-1', title: 'New Chat' }]),
      getSession: vi.fn().mockResolvedValue({ id: 'sess-1', title: 'New Chat', messages: [] }),
      renameSession: vi.fn().mockResolvedValue({ id: 'sess-1', title: 'Renamed Chat' }),
      deleteSession: vi.fn().mockResolvedValue(undefined),
      cloneSession: vi.fn(),
      saveMessages: vi.fn(),
      getAIOptions: vi.fn(),
      setAIOptions: vi.fn(),
      getAutoSavePreference: vi.fn(),
      setAutoSavePreference: vi.fn()
    }

    const customModule = new KernelAIModule(
      mockPermissions,
      mockAIService,
      mockToolRegistry,
      undefined,
      mockSessionService as any
    )

    vi.mocked(mockPermissions.hasCapability).mockReturnValue(true)

    const createRes = await customModule.handle('plugin-a', 'kernel:ai:createSession', { title: 'New Chat' })
    expect(mockSessionService.createSession).toHaveBeenCalledWith('New Chat', undefined)
    expect(createRes).toEqual({ id: 'sess-1', title: 'New Chat' })

    const listRes = await customModule.handle('plugin-a', 'kernel:ai:listSessions', { page: 1, pageSize: 10 })
    expect(mockSessionService.listSessions).toHaveBeenCalledWith(1, 10)
    expect(listRes).toEqual([{ id: 'sess-1', title: 'New Chat' }])

    const getRes = await customModule.handle('plugin-a', 'kernel:ai:getSession', { id: 'sess-1' })
    expect(mockSessionService.getSession).toHaveBeenCalledWith('sess-1')
    expect(getRes).toEqual({ id: 'sess-1', title: 'New Chat', messages: [] })

    const renameRes = await customModule.handle('plugin-a', 'kernel:ai:renameSession', { id: 'sess-1', title: 'Renamed Chat' })
    expect(mockSessionService.renameSession).toHaveBeenCalledWith('sess-1', 'Renamed Chat')
    expect(renameRes).toEqual({ id: 'sess-1', title: 'Renamed Chat' })

    const delRes = await customModule.handle('plugin-a', 'kernel:ai:deleteSession', { id: 'sess-1' })
    expect(mockSessionService.deleteSession).toHaveBeenCalledWith('sess-1')
    expect(delRes).toEqual({ success: true })
  })

  it('S7-03: session actions require ai:sessions, not ai:chat', async () => {
    const customModule = new KernelAIModule(
      mockPermissions,
      mockAIService,
      mockToolRegistry,
      undefined,
      { listSessions: vi.fn().mockResolvedValue([]) } as any
    )
    // Plugin has ai:chat but NOT ai:sessions.
    vi.mocked(mockPermissions.hasCapability).mockImplementation((_p, cap) => cap === 'ai:chat')

    await expect(
      customModule.handle('plugin-a', 'kernel:ai:listSessions', {})
    ).rejects.toMatchObject({ code: 'PERMISSION_DENIED', permission: 'ai:sessions' })
  })

  it('throws NOT_FOUND for unknown action type', async () => {
    await expect(
      module.handle('plugin-a', 'kernel:ai:unknown', {})
    ).rejects.toMatchObject({
      code: 'NOT_FOUND',
      message: "Unknown action 'kernel:ai:unknown' in module 'kernel:ai'"
    })
  })
})
