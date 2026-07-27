import { describe, it, expect, vi, beforeEach } from 'vitest'
import { KernelAIModule } from '../../../kernel/api-modules/KernelAIModule'
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

  it('throws NOT_FOUND for unknown action type', async () => {
    await expect(
      module.handle('plugin-a', 'kernel:ai:unknown', {})
    ).rejects.toMatchObject({
      code: 'NOT_FOUND',
      message: "Unknown action 'kernel:ai:unknown' in module 'kernel:ai'"
    })
  })
})
