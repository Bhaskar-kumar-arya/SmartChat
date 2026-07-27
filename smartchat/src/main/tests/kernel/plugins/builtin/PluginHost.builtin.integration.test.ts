import { describe, it, expect, beforeEach } from 'vitest'
import { PluginHost } from '../../../../kernel/plugins/PluginHost'
import { PluginRegistry } from '../../../../kernel/plugins/PluginRegistry'
import { PluginLoader } from '../../../../kernel/plugins/PluginLoader'
import { KernelAPIRouter } from '../../../../kernel/KernelAPIRouter'
import { ContributionRegistry } from '../../../../kernel/contributions/ContributionRegistry'
import { WhatsappCorePlugin } from '../../../../plugins/builtin/whatsapp-core'
import { AIAssistantPlugin } from '../../../../plugins/builtin/ai-assistant'
import { SearchPlugin } from '../../../../plugins/builtin/search'
import { NotificationsPlugin } from '../../../../plugins/builtin/notifications'

describe('PluginHost built-in integration', () => {
  let registry: PluginRegistry
  let loader: PluginLoader
  let router: KernelAPIRouter
  let contributionRegistry: ContributionRegistry
  let host: PluginHost

  beforeEach(() => {
    registry = new PluginRegistry()
    loader = new PluginLoader('/tmp/fake-plugins')
    router = new KernelAPIRouter()
    contributionRegistry = new ContributionRegistry()
    host = new PluginHost(loader, registry, router, contributionRegistry)
  })

  it('registerBuiltin loads built-in plugins and populates ContributionRegistry', async () => {
    const whatsapp = new WhatsappCorePlugin()
    const ai = new AIAssistantPlugin()
    const search = new SearchPlugin()
    const notifications = new NotificationsPlugin()

    await host.registerBuiltin(whatsapp)
    await host.registerBuiltin(ai)
    await host.registerBuiltin(search)
    await host.registerBuiltin(notifications)

    expect(host.listLoaded()).toHaveLength(4)
    expect(host.listLoaded()).toContain('com.smartchat.builtin.whatsapp-core')
    expect(host.listLoaded()).toContain('com.smartchat.builtin.ai-assistant')
    expect(host.listLoaded()).toContain('com.smartchat.builtin.search')
    expect(host.listLoaded()).toContain('com.smartchat.builtin.notifications')

    const chatActions = contributionRegistry.getAll('chat-action')
    expect(chatActions).toHaveLength(7)
    expect(chatActions.map((a) => a.id)).toEqual([
      'pin',
      'unpin',
      'archive',
      'unarchive',
      'mute',
      'unmute',
      'mark-read'
    ])
    expect(chatActions[0].pluginId).toBe('com.smartchat.builtin.whatsapp-core')

    const aiTools = contributionRegistry.getAll('ai-tool')
    expect(aiTools).toHaveLength(6)
    expect(aiTools.map((t) => t.name)).toEqual([
      'chatAction',
      'sendMessage',
      'messageAction',
      'readMessages',
      'queryDatabase',
      'executeScript'
    ])
    expect(aiTools[0].pluginId).toBe('com.smartchat.builtin.ai-assistant')

    const sidebarPanels = contributionRegistry.getAll('sidebar-panel')
    expect(sidebarPanels).toHaveLength(1)
    expect(sidebarPanels[0].id).toBe('search')
    expect(sidebarPanels[0].pluginId).toBe('com.smartchat.builtin.search')

    const settingsPages = contributionRegistry.getAll('settings-page')
    expect(settingsPages).toHaveLength(1)
    expect(settingsPages[0].id).toBe('notifications')
    expect(settingsPages[0].pluginId).toBe('com.smartchat.builtin.notifications')
  })

  it('unloading a built-in removes its contributions from ContributionRegistry', async () => {
    const whatsapp = new WhatsappCorePlugin()
    await host.registerBuiltin(whatsapp)

    expect(contributionRegistry.getAll('chat-action')).toHaveLength(7)

    await host.unload('com.smartchat.builtin.whatsapp-core')

    expect(host.listLoaded()).not.toContain('com.smartchat.builtin.whatsapp-core')
    expect(contributionRegistry.getAll('chat-action')).toHaveLength(0)
  })
})
