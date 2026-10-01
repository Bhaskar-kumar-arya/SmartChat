import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { createTestKernel, type TestKernel } from '../helpers/createTestKernel'

describe('External Plugin E2E Lifecycle', () => {
  let k: TestKernel

  beforeEach(() => {
    k = createTestKernel({ tmpPrefix: 'smartchat-e2e-test-' })
  })

  afterEach(async () => {
    await k.teardown()
  })

  it('installs, loads in a real worker via host.load, registers contributions, handles execution, and unloads plugin', async () => {
    const pluginId = 'com.example.e2e-test'
    k.writePlugin({
      id: pluginId,
      manifest: {
        name: 'E2E Test Plugin',
        permissions: ['chats:read'],
        contributions: { chatActions: [{ id: 'e2e-action', label: 'E2E Action' }] }
      }
    })

    // 1. List installed plugins
    const installed = await k.loader.listInstalled()
    expect(installed.map((m) => m.id)).toEqual([pluginId])

    // 2. Load through the host: real worker, real activation handshake, and
    //    contributions registered from the manifest by the host itself.
    await k.host.load(pluginId)
    expect(k.workers.spawned).toBe(1)

    // 3. Plugin is listed
    expect(k.host.listLoaded()).toContain(pluginId)

    // 4. Contributions registered by the host
    const found = k.contributions.getAll('chat-action').find((a) => a.id === 'e2e-action')
    expect(found).toBeDefined()
    expect(found?.pluginId).toBe(pluginId)
    expect(found?.label).toBe('E2E Action')

    // 5. Execute a contribution over the real channel; the worker echoes the request type.
    const channel = k.registry.get(pluginId)!.channel as unknown as {
      sendRequestToPlugin: (m: { id: string; type: string; payload: unknown }) => Promise<{ ok: boolean; payload: unknown }>
    }
    const res = await channel.sendRequestToPlugin({
      id: 'req-1',
      type: 'contribution:execute:chat-action',
      payload: { id: 'e2e-action', context: { jid: '12345@s.whatsapp.net' } }
    })
    expect(res.ok).toBe(true)
    expect(res.payload).toEqual({ echoed: 'contribution:execute:chat-action' })

    // 6. Unload plugin
    await k.host.unload(pluginId)
    expect(k.host.listLoaded()).not.toContain(pluginId)

    // 7. Contributions removed
    expect(k.contributions.getAll('chat-action').find((a) => a.pluginId === pluginId)).toBeUndefined()
  })
})
