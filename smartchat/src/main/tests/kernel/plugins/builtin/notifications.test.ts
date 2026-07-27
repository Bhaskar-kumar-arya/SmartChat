import { describe, it, expect, vi } from 'vitest'
import { NotificationsPlugin } from '../../../../plugins/builtin/notifications'
import { PluginContext } from '../../../../kernel/plugins/PluginContext'

describe('NotificationsPlugin', () => {
  it('registers notifications settings page contribution on activate()', async () => {
    const plugin = new NotificationsPlugin()
    const registerSettingsPage = vi.fn()

    const mockCtx: PluginContext = {
      id: plugin.id,
      manifest: plugin.manifest,
      log: {
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn()
      },
      contributions: {
        registerSettingsPage
      } as unknown as PluginContext['contributions']
    }

    await plugin.activate(mockCtx)

    expect(registerSettingsPage).toHaveBeenCalledWith('notifications', {
      title: 'Notifications'
    })
  })

  it('deactivate() resolves cleanly', async () => {
    const plugin = new NotificationsPlugin()
    await expect(plugin.deactivate()).resolves.toBeUndefined()
  })
})
