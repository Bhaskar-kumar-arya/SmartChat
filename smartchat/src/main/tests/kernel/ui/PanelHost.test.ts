import { describe, it, expect, beforeEach } from 'vitest'
import { PanelHost } from '../../../kernel/ui/PanelHost'

describe('PanelHost', () => {
  let panelHost: PanelHost

  beforeEach(() => {
    panelHost = new PanelHost()
  })

  it('registers a panel and assigns a unique panelId', () => {
    const panelId = panelHost.registerPanel({
      contributionId: 'sidebar-1',
      pluginId: 'com.acme.plugin',
      panelPath: 'panels/sidebar.html',
      type: 'sidebar'
    })

    expect(panelId).toBeDefined()
    expect(typeof panelId).toBe('string')
    expect(panelId.length).toBeGreaterThan(0)

    const desc = panelHost.getPanel(panelId)
    expect(desc).toEqual({
      panelId,
      contributionId: 'sidebar-1',
      pluginId: 'com.acme.plugin',
      panelPath: 'panels/sidebar.html',
      type: 'sidebar'
    })
  })

  it('returns existing panelId if panel with same pluginId and contributionId is re-registered', () => {
    const id1 = panelHost.registerPanel({
      contributionId: 'sidebar-1',
      pluginId: 'com.acme.plugin',
      panelPath: 'panels/sidebar.html',
      type: 'sidebar'
    })

    const id2 = panelHost.registerPanel({
      contributionId: 'sidebar-1',
      pluginId: 'com.acme.plugin',
      panelPath: 'panels/sidebar.html',
      type: 'sidebar'
    })

    expect(id1).toBe(id2)
  })

  // S9-06
  it('re-points the descriptor when the same contribution re-registers with a changed panel path', () => {
    const id1 = panelHost.registerPanel({
      contributionId: 'sidebar-1',
      pluginId: 'com.acme.plugin',
      panelPath: 'panels/old.html',
      type: 'sidebar'
    })

    const id2 = panelHost.registerPanel({
      contributionId: 'sidebar-1',
      pluginId: 'com.acme.plugin',
      panelPath: 'panels/new.html',
      type: 'sidebar'
    })

    expect(id2).toBe(id1)
    expect(panelHost.getPanel(id1)?.panelPath).toBe('panels/new.html')
  })

  // P2-S9-02
  it('does not resolve getPanel / getPluginId by a shared contributionId', () => {
    const idA = panelHost.registerPanel({
      contributionId: 'settings',
      pluginId: 'com.a.plugin',
      panelPath: 'a.html',
      type: 'settings'
    })
    panelHost.registerPanel({
      contributionId: 'settings',
      pluginId: 'com.b.plugin',
      panelPath: 'b.html',
      type: 'settings'
    })

    // Passing the author-chosen contribution id must NOT resolve to another
    // plugin's descriptor / identity.
    expect(panelHost.getPanel('settings')).toBeUndefined()
    expect(panelHost.getPluginId('settings')).toBeUndefined()

    // The real per-panel UUID still resolves.
    expect(panelHost.getPluginId(idA)).toBe('com.a.plugin')
  })

  it('finds panel by pluginId and contributionId', () => {
    const panelId = panelHost.registerPanel({
      contributionId: 'settings-1',
      pluginId: 'com.acme.plugin',
      panelPath: 'panels/settings.html',
      type: 'settings'
    })

    const found = panelHost.findPanel('com.acme.plugin', 'settings-1')
    expect(found).toBeDefined()
    expect(found?.panelId).toBe(panelId)
  })

  it('resolves pluginId from panelId', () => {
    const panelId = panelHost.registerPanel({
      contributionId: 'sidebar-1',
      pluginId: 'com.acme.plugin',
      panelPath: 'panels/sidebar.html',
      type: 'sidebar'
    })

    expect(panelHost.getPluginId(panelId)).toBe('com.acme.plugin')
    expect(panelHost.getPluginId('non-existent')).toBeUndefined()
  })

  it('deregisters all panels for a plugin', () => {
    const id1 = panelHost.registerPanel({
      contributionId: 'sidebar-1',
      pluginId: 'com.acme.plugin',
      panelPath: 'panels/sidebar.html',
      type: 'sidebar'
    })
    const id2 = panelHost.registerPanel({
      contributionId: 'settings-1',
      pluginId: 'com.acme.plugin',
      panelPath: 'panels/settings.html',
      type: 'settings'
    })
    const id3 = panelHost.registerPanel({
      contributionId: 'sidebar-2',
      pluginId: 'com.other.plugin',
      panelPath: 'panels/other.html',
      type: 'sidebar'
    })

    panelHost.deregisterPlugin('com.acme.plugin')

    expect(panelHost.getPanel(id1)).toBeUndefined()
    expect(panelHost.getPanel(id2)).toBeUndefined()
    expect(panelHost.getPluginId(id1)).toBeUndefined()
    expect(panelHost.findPanel('com.acme.plugin', 'sidebar-1')).toBeUndefined()

    expect(panelHost.getPanel(id3)).toBeDefined()
    expect(panelHost.getPluginId(id3)).toBe('com.other.plugin')
  })
})
