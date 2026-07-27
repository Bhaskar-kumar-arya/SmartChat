import { describe, it, expect, vi } from 'vitest'
import { AIAssistantPlugin } from '../../../../plugins/builtin/ai-assistant'
import { PluginContext } from '../../../../kernel/plugins/PluginContext'
import { AITool, IToolRegistry } from '../../../../services/ai/IToolRegistry'

describe('AIAssistantPlugin', () => {
  it('registers all 6 AI tool contributions on activate()', async () => {
    const plugin = new AIAssistantPlugin()
    const registerAITool = vi.fn()

    const mockCtx: PluginContext = {
      id: plugin.id,
      manifest: plugin.manifest,
      log: {
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn()
      },
      contributions: {
        registerAITool
      } as unknown as PluginContext['contributions']
    }

    await plugin.activate(mockCtx)

    expect(registerAITool).toHaveBeenCalledTimes(6)
    const registeredNames = registerAITool.mock.calls.map((call) => call[0])
    expect(registeredNames).toEqual([
      'chatAction',
      'sendMessage',
      'messageAction',
      'readMessages',
      'queryDatabase',
      'executeScript'
    ])
  })

  it('delegates execution to tool in toolRegistry and returns real tool result', async () => {
    const mockTool: AITool = {
      name: 'sendMessage',
      description: 'Send a WhatsApp message',
      parametersSchema: {},
      requiresPermission: true,
      execute: vi.fn().mockResolvedValue({ text: '{"success":true,"detail":"Message sent to 123@s.whatsapp.net"}' })
    }

    const mockRegistry: IToolRegistry = {
      registerTool: vi.fn(),
      getTool: vi.fn().mockImplementation((name: string) => name === 'sendMessage' ? mockTool : undefined),
      getAllTools: vi.fn().mockReturnValue([mockTool]),
      getToolDefinitions: vi.fn().mockReturnValue([])
    }

    const plugin = new AIAssistantPlugin(mockRegistry)
    const registeredHandlers = new Map<string, Function>()

    const mockCtx: PluginContext = {
      id: plugin.id,
      manifest: plugin.manifest,
      log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
      contributions: {
        registerAITool: (name, handler) => {
          registeredHandlers.set(name, handler)
        }
      } as unknown as PluginContext['contributions']
    }

    await plugin.activate(mockCtx)

    const sendMessageHandler = registeredHandlers.get('sendMessage')
    expect(sendMessageHandler).toBeDefined()

    const result = await sendMessageHandler!({ jid: '123@s.whatsapp.net', text: 'Hello!' })
    expect(mockTool.execute).toHaveBeenCalledWith({ jid: '123@s.whatsapp.net', text: 'Hello!' })
    expect(result).toEqual({ text: '{"success":true,"detail":"Message sent to 123@s.whatsapp.net"}' })
  })

  it('falls back to ctx.ai.callTool if toolRegistry is not provided', async () => {
    const plugin = new AIAssistantPlugin()
    const registeredHandlers = new Map<string, Function>()

    const mockCallTool = vi.fn().mockResolvedValue({ text: '{"success":true,"tool":"chatAction"}' })

    const mockCtx: PluginContext = {
      id: plugin.id,
      manifest: plugin.manifest,
      log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
      ai: {
        chat: vi.fn(),
        callTool: mockCallTool
      },
      contributions: {
        registerAITool: (name, handler) => {
          registeredHandlers.set(name, handler)
        }
      } as unknown as PluginContext['contributions']
    }

    await plugin.activate(mockCtx)

    const chatActionHandler = registeredHandlers.get('chatAction')
    const result = await chatActionHandler!({ action: 'pin', jid: '123@s.whatsapp.net' })

    expect(mockCallTool).toHaveBeenCalledWith('chatAction', { action: 'pin', jid: '123@s.whatsapp.net' })
    expect(result).toEqual({ text: '{"success":true,"tool":"chatAction"}' })
  })

  it('deactivate() resolves cleanly', async () => {
    const plugin = new AIAssistantPlugin()
    await expect(plugin.deactivate()).resolves.toBeUndefined()
  })

  it('manifest has correct id and permissions', () => {
    const plugin = new AIAssistantPlugin()
    expect(plugin.id).toBe('com.smartchat.builtin.ai-assistant')
    expect(plugin.manifest.apiVersion).toBe('2')
    expect(plugin.manifest.permissions).toEqual(['ai:tools:register', 'ai:tools:call'])
    expect(plugin.manifest.contributions.aiTools).toHaveLength(6)
  })
})
