import { IBuiltinPlugin } from '../../../kernel/plugins/IBuiltinPlugin'
import { PluginManifest } from '../../../kernel/plugins/PluginManifest'
import { PluginContext } from '../../../kernel/plugins/PluginContext'

export class SearchPlugin implements IBuiltinPlugin {
  readonly id = 'com.smartchat.builtin.search'

  readonly manifest: PluginManifest = {
    id: 'com.smartchat.builtin.search',
    name: 'Search Panel Plugin',
    version: '1.0.0',
    apiVersion: '2',
    main: 'index.ts',
    permissions: [],
    contributions: {
      sidebarPanels: [
        { id: 'search', title: 'Search', icon: 'search' }
      ]
    }
  }

  async activate(ctx: PluginContext): Promise<void> {
    const register = ctx.contributions?.registerSidebarPanel
    if (!register) return

    register('search', {
      title: 'Search',
      icon: 'search'
    })
  }

  async deactivate(): Promise<void> {
    // Cleanup handled by host
  }
}
