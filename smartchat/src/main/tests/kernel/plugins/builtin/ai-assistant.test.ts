import { describe, it, expect, vi } from 'vitest'
import { AIAssistantPlugin } from '../../../../plugins/builtin/ai-assistant'
import { PluginContext } from '../../../../kernel/plugins/PluginContext'

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
      }
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

  it('deactivate() resolves cleanly', async () => {
    const plugin = new AIAssistantPlugin()
    await expect(plugin.deactivate()).resolves.toBeUndefined()
  })

  it('manifest has correct id and permissions', () => {
    const plugin = new AIAssistantPlugin()
    expect(plugin.id).toBe('com.smartchat.builtin.ai-assistant')
    expect(plugin.manifest.apiVersion).toBe('2')
    expect(plugin.manifest.permissions).toEqual(['ai:tools:register'])
    expect(plugin.manifest.contributions.aiTools).toHaveLength(6)
  })
})
