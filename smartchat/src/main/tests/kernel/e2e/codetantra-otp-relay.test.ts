import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import path from 'path'
import os from 'os'
import fs from 'fs'
import { PluginLoader } from '../../../kernel/plugins/PluginLoader'
import { PluginRegistry } from '../../../kernel/plugins/PluginRegistry'
import { PluginHost } from '../../../kernel/plugins/PluginHost'
import { ContributionRegistry } from '../../../kernel/contributions/ContributionRegistry'
import { KernelAPIRouter } from '../../../kernel/KernelAPIRouter'
import { PermissionStore } from '../../../kernel/permissions/PermissionStore'

describe('CodeTantra OTP Relay Plugin E2E Test', () => {
  let tmpDir: string
  let loader: PluginLoader
  let pluginRegistry: PluginRegistry
  let contribRegistry: ContributionRegistry
  let router: KernelAPIRouter
  let permissions: PermissionStore
  let host: PluginHost

  const pluginsDir = path.join(__dirname, '../../../../../plugins')
  const scextPath = path.join(pluginsDir, 'codetantra-otp-relay.scext')

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'codetantra-otp-relay-test-'))
    loader = new PluginLoader(tmpDir)
    pluginRegistry = new PluginRegistry()
    contribRegistry = new ContributionRegistry()
    router = new KernelAPIRouter()
    permissions = new PermissionStore()

    host = new PluginHost(loader, pluginRegistry, router, contribRegistry)
  })

  afterEach(async () => {
    try {
      const loaded = host.listLoaded()
      for (const id of loaded) {
        await host.unload(id)
      }
    } catch {
      // ignore
    }
    if (fs.existsSync(tmpDir)) {
      fs.rmSync(tmpDir, { recursive: true, force: true })
    }
  })

  it('installs .scext plugin, auto-registers sidebar panel, slash commands, and chat actions', async () => {
    // 1. Verify plugin package archive exists
    expect(fs.existsSync(scextPath)).toBe(true)

    // 2. Install .scext archive
    const manifest = await loader.install(scextPath)
    expect(manifest.id).toBe('com.smartchat.codetantra-otp-relay')
    expect(manifest.name).toBe('CodeTantra OTP Relay')

    // 3. Register permissions & Load plugin
    permissions.registerPluginManifest(manifest.id, manifest.permissions || [])
    await host.load(manifest.id)

    expect(host.listLoaded()).toContain(manifest.id)

    // 4. Check registered contributions
    const sidebarPanels = contribRegistry.getAll('sidebar-panel')
    const slashCommands = contribRegistry.getAll('slash-command')
    const chatActions = contribRegistry.getAll('chat-action')
    const aiTools = contribRegistry.getAll('ai-tool')

    expect(sidebarPanels.some(p => p.id === 'codetantra-dashboard')).toBe(true)
    expect(slashCommands.some(c => c.name === 'relay-otp')).toBe(true)
    expect(slashCommands.some(c => c.name === 'codetantra')).toBe(true)
    expect(chatActions.some(a => a.id === 'action.codetantra.relay-otp')).toBe(true)
    expect(aiTools.some(t => t.name === 'codetantra_submit_otp')).toBe(true)
  })
})
