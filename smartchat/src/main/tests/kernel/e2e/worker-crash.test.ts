/**
 * F-KRN-1 (B-KRN-05 / R-KRN-04): a plugin worker that dies after activation must
 * be noticed by the kernel: the plugin leaves `listLoaded`, its contributions are
 * unregistered, and pending kernel->plugin requests reject immediately instead of
 * hanging for PLUGIN_REQUEST_TIMEOUT_MS.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { createTestKernel, type TestKernel } from '../helpers/createTestKernel'

const PLUGIN_ID = 'com.smartchat.crash-test'

/** Acks everything; after activation it throws asynchronously (uncaught in the worker thread). */
const crashAfterActivateSource = `
const { parentPort } = require('node:worker_threads')
parentPort.on('message', (msg) => {
  if (!msg || typeof msg.id !== 'string' || typeof msg.type !== 'string') return
  if (msg.type === 'ping') return // never answered: simulates a hung request
  parentPort.postMessage({ id: msg.id, ok: true, payload: {} })
  if (msg.type === 'plugin:activate') setTimeout(() => { throw new Error('async boom') }, 30)
})
`

async function waitFor(cond: () => boolean, ms = 3000): Promise<void> {
  const start = Date.now()
  while (!cond()) {
    if (Date.now() - start > ms) throw new Error('waitFor timed out')
    await new Promise((r) => setTimeout(r, 20))
  }
}

describe('worker crash handling (real worker)', () => {
  let k: TestKernel

  beforeEach(() => {
    k = createTestKernel({ tmpPrefix: 'smartchat-worker-crash-test-' })
  })
  afterEach(async () => {
    await k.teardown()
  })

  it('a worker that throws asynchronously after activation is unloaded and its contributions removed', async () => {
    k.writePlugin({
      id: PLUGIN_ID,
      manifest: { contributions: { chatActions: [{ id: 'crash.action', label: 'Crash' }] } },
      source: crashAfterActivateSource
    })
    await k.host.load(PLUGIN_ID)
    expect(k.host.listLoaded()).toContain(PLUGIN_ID)
    expect(k.contributions.getAll('chat-action').some((a) => a.id === 'crash.action')).toBe(true)

    await waitFor(() => !k.host.listLoaded().includes(PLUGIN_ID), 1000)

    expect(k.host.listLoaded()).not.toContain(PLUGIN_ID)
    expect(k.contributions.getAll('chat-action').some((a) => a.id === 'crash.action')).toBe(false)
  })

  it('pending kernel->plugin requests reject promptly when the worker dies', async () => {
    k.writePlugin({ id: PLUGIN_ID, source: crashAfterActivateSource })
    const { channel } = await k.loader.load(PLUGIN_ID)
    const bidi = channel as unknown as {
      sendRequestToPlugin(m: { id: string; type: string; payload: unknown }): Promise<unknown>
      sendToPlugin(m: { id: string; type: string; payload: unknown }): void
    }
    const pending = bidi.sendRequestToPlugin({ id: 'p1', type: 'ping', payload: {} })
    // Trigger the crash.
    bidi.sendToPlugin({ id: 'a1', type: 'plugin:activate', payload: {} })

    const started = Date.now()
    await expect(pending).rejects.toThrow()
    expect(Date.now() - started).toBeLessThan(1000)
  })
})
