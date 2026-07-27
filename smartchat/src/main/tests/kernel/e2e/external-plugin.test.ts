import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import fs from 'fs'
import path from 'path'
import os from 'os'
import { PluginLoader } from '../../../kernel/plugins/PluginLoader'
import { PluginRegistry } from '../../../kernel/plugins/PluginRegistry'
import { PluginHost } from '../../../kernel/plugins/PluginHost'
import { ContributionRegistry } from '../../../kernel/contributions/ContributionRegistry'
import { KernelAPIRouter } from '../../../kernel/KernelAPIRouter'
import { PluginManifest } from '../../../kernel/plugins/PluginManifest'
import { DirectPluginChannel } from '../../../kernel/channels/DirectPluginChannel'

describe('External Plugin E2E Lifecycle', () => {
  let tmpDir: string
  let loader: PluginLoader
  let registry: PluginRegistry
  let contribRegistry: ContributionRegistry
  let router: KernelAPIRouter
  let host: PluginHost

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'smartchat-e2e-test-'))
    loader = new PluginLoader(tmpDir)
    registry = new PluginRegistry()
    contribRegistry = new ContributionRegistry()
    router = new KernelAPIRouter()
    host = new PluginHost(loader, registry, router, contribRegistry)
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

  it('installs, loads, registers contributions, handles execution, and unloads plugin', async () => {
    const pluginId = 'com.example.e2e-test'
    const pluginDir = path.join(tmpDir, pluginId)
    fs.mkdirSync(pluginDir, { recursive: true })

    const manifest: PluginManifest = {
      id: pluginId,
      name: 'E2E Test Plugin',
      version: '1.0.0',
      apiVersion: '2',
      main: 'index.js',
      permissions: ['chats:read'],
      contributions: {
        chatActions: [
          { id: 'e2e-action', label: 'E2E Action' }
        ]
      }
    }

    fs.writeFileSync(path.join(pluginDir, 'manifest.json'), JSON.stringify(manifest, null, 2), 'utf8')
    fs.writeFileSync(path.join(pluginDir, 'index.js'), '// mock entry point', 'utf8')

    // 1. List installed plugins
    const installed = await loader.listInstalled()
    expect(installed.length).toBe(1)
    expect(installed[0].id).toBe(pluginId)

    // 2. Direct channel simulation for in-memory E2E test execution
    const channel = new DirectPluginChannel()
    let actionExecuted = false
    let actionPayload: any = null

    channel.onKernelRequest(async (req) => {
      if (req.type === 'contribution:execute:chat-action') {
        actionExecuted = true
        actionPayload = req.payload
      }
    })

    registry.register({
      id: pluginId,
      manifest,
      channel,
      isBuiltin: false
    })

    // Register contributions from manifest
    for (const action of manifest.contributions.chatActions || []) {
      contribRegistry.register('chat-action', {
        pluginId,
        id: action.id,
        label: action.label
      })
    }

    // 3. Verify plugin in listLoaded()
    expect(host.listLoaded()).toContain(pluginId)

    // 4. Verify contributions registered
    const chatActions = contribRegistry.getAll('chat-action')
    const found = chatActions.find((a) => a.id === 'e2e-action')
    expect(found).toBeDefined()
    expect(found?.pluginId).toBe(pluginId)
    expect(found?.label).toBe('E2E Action')

    // 5. Execute contribution trigger
    channel.sendToPlugin({
      id: 'req-1',
      type: 'contribution:execute:chat-action',
      payload: { id: 'e2e-action', context: { jid: '12345@s.whatsapp.net' } }
    })

    expect(actionExecuted).toBe(true)
    expect(actionPayload).toEqual({ id: 'e2e-action', context: { jid: '12345@s.whatsapp.net' } })

    // 6. Unload plugin
    await host.unload(pluginId)
    expect(host.listLoaded()).not.toContain(pluginId)

    // 7. Verify contributions removed
    const postUnloadActions = contribRegistry.getAll('chat-action')
    expect(postUnloadActions.find((a) => a.pluginId === pluginId)).toBeUndefined()
  })
})
