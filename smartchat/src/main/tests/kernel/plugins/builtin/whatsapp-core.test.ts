import { describe, it, expect, vi } from 'vitest'
import { WhatsappCorePlugin } from '../../../../plugins/builtin/whatsapp-core'
import { PluginContext } from '../../../../kernel/plugins/PluginContext'

describe('WhatsappCorePlugin', () => {
  it('registers all 7 chat action contributions on activate()', async () => {
    const plugin = new WhatsappCorePlugin()
    const registerChatAction = vi.fn()

    const mockCtx: PluginContext = {
      id: plugin.id,
      manifest: plugin.manifest,
      log: {
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn()
      },
      contributions: {
        registerChatAction
      }
    }

    await plugin.activate(mockCtx)

    expect(registerChatAction).toHaveBeenCalledTimes(7)
    const registeredIds = registerChatAction.mock.calls.map((call) => call[0])
    expect(registeredIds).toEqual([
      'pin',
      'unpin',
      'archive',
      'unarchive',
      'mute',
      'unmute',
      'mark-read'
    ])
  })

  it('deactivate() resolves cleanly', async () => {
    const plugin = new WhatsappCorePlugin()
    await expect(plugin.deactivate()).resolves.toBeUndefined()
  })

  it('manifest is valid API v2 manifest', () => {
    const plugin = new WhatsappCorePlugin()
    expect(plugin.id).toBe('com.smartchat.builtin.whatsapp-core')
    expect(plugin.manifest.apiVersion).toBe('2')
    expect(plugin.manifest.permissions).toEqual(['chats:read', 'chats:write'])
    expect(plugin.manifest.contributions.chatActions).toHaveLength(7)
  })
})
