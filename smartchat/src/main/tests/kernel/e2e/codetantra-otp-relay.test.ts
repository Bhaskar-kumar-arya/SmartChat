import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import path from 'path'
import fs from 'fs'
import { KernelEventsModule } from '../../../kernel/api-modules/KernelEventsModule'
import { createTestKernel, type TestKernel } from '../helpers/createTestKernel'

describe('CodeTantra OTP Relay Plugin E2E Test', () => {
  let k: TestKernel

  const pluginsDir = path.join(__dirname, '../../../../../plugins')
  const scextPath = path.join(pluginsDir, 'codetantra-otp-relay.scext')

  beforeEach(() => {
    // The plugin subscribes to WA events on activation; without a registered events module
    // the router rejects it asynchronously (unhandled). A null bus just queues the subscription.
    k = createTestKernel({
      tmpPrefix: 'codetantra-otp-relay-test-',
      modules: ({ permissions }) => [new KernelEventsModule(permissions, null)]
    })
  })

  afterEach(async () => {
    await k.teardown()
  })

  it('installs .scext plugin, auto-registers sidebar panel, slash commands, and chat actions', async () => {
    // 1. Verify plugin package archive exists
    expect(fs.existsSync(scextPath)).toBe(true)

    // 2. Install .scext archive
    const manifest = await k.loader.install(scextPath)
    expect(manifest.id).toBe('com.smartchat.codetantra-otp-relay')
    expect(manifest.name).toBe('CodeTantra OTP Relay')

    // 3. Register permissions & Load plugin
    k.permissions.registerPluginManifest(manifest.id, manifest.permissions || [])
    await k.host.load(manifest.id)

    expect(k.host.listLoaded()).toContain(manifest.id)

    // 4. Check registered contributions
    const sidebarPanels = k.contributions.getAll('sidebar-panel')
    const slashCommands = k.contributions.getAll('slash-command')
    const chatActions = k.contributions.getAll('chat-action')
    const aiTools = k.contributions.getAll('ai-tool')

    expect(sidebarPanels.some(p => p.id === 'codetantra-dashboard')).toBe(true)
    expect(slashCommands.some(c => c.name === 'relay-otp')).toBe(true)
    expect(slashCommands.some(c => c.name === 'codetantra')).toBe(true)
    expect(chatActions.some(a => a.id === 'action.codetantra.relay-otp')).toBe(true)
    expect(aiTools.some(t => t.name === 'codetantra_submit_otp')).toBe(true)
  })
  // Plugin panels are served with `connect-src 'self' plugin:` (F10-01), so a panel-side
  // fetch to login.microsoftonline.com dies with "Failed to fetch". The auth-code exchange
  // must run in the plugin worker (no CSP) and be reached via ai.callTool.
  it.fails('registers codetantra_exchange_code so the panel can delegate the token exchange', async () => {
    const manifest = await k.loader.install(scextPath)
    k.permissions.registerPluginManifest(manifest.id, manifest.permissions || [])
    await k.host.load(manifest.id)

    expect(k.contributions.getAll('ai-tool').some((t) => t.name === 'codetantra_exchange_code')).toBe(true)
  })

  it.fails('panel does not fetch the Microsoft token endpoint itself (blocked by plugin CSP)', () => {
    const html = fs.readFileSync(path.join(pluginsDir, 'codetantra-otp-relay-plugin/panel/index.html'), 'utf8')
    expect(html).not.toMatch(/fetch\(\s*TOKEN_ENDPOINT/)
  })
})
