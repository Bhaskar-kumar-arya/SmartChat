import { describe, it, expect, vi } from 'vitest'
import { SearchPlugin } from '../../../../plugins/builtin/search'
import { PluginContext } from '../../../../kernel/plugins/PluginContext'

describe('SearchPlugin', () => {
  it('registers search sidebar panel contribution on activate()', async () => {
    const plugin = new SearchPlugin()
    const registerSidebarPanel = vi.fn()

    const mockCtx: PluginContext = {
      id: plugin.id,
      manifest: plugin.manifest,
      log: {
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn()
      },
      contributions: {
        registerSidebarPanel
      }
    }

    await plugin.activate(mockCtx)

    expect(registerSidebarPanel).toHaveBeenCalledWith('search', {
      title: 'Search',
      icon: 'search'
    })
  })

  it('deactivate() resolves cleanly', async () => {
    const plugin = new SearchPlugin()
    await expect(plugin.deactivate()).resolves.toBeUndefined()
  })
})
