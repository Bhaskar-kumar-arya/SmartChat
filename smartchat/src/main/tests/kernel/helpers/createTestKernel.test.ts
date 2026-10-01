import { describe, it, expect, afterEach } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import type { Worker } from 'node:worker_threads'
import { createTestKernel, type TestKernel } from './createTestKernel'

const PLUGIN_ID = 'com.smartchat.harness-test'

describe('createTestKernel harness', () => {
  let k: TestKernel | undefined

  afterEach(async () => {
    await k?.teardown()
    k = undefined
  })

  it('wires real kernel pieces: UI module registered on the router, plugin dir isolated under tmpDir', () => {
    k = createTestKernel()
    expect(k.router.getModule('kernel:ui')).toBe(k.uiModule)
    expect(fs.existsSync(path.join(k.tmpDir, 'permissions.json'))).toBe(true)
    expect(k.host.listLoaded()).toEqual([])
    expect(k.workers.spawned).toBe(0)
  })

  it('writePlugin + host.load runs a real worker through the activation handshake and unloads it', async () => {
    k = createTestKernel()
    k.writePlugin({ id: PLUGIN_ID })
    await k.host.load(PLUGIN_ID)
    expect(k.host.listLoaded()).toContain(PLUGIN_ID)
    expect(k.workers.spawned).toBe(1)
    await k.host.unload(PLUGIN_ID)
    expect(k.host.listLoaded()).not.toContain(PLUGIN_ID)
  })

  it('a plugin whose worker rejects activation makes host.load fail', async () => {
    k = createTestKernel()
    k.writePlugin({
      id: PLUGIN_ID,
      source: `
        const { parentPort } = require('node:worker_threads')
        parentPort.on('message', (m) => parentPort.postMessage({ id: m.id, ok: false, error: { code: 'INTERNAL_ERROR', message: 'boom' } }))
      `
    })
    await expect(k.host.load(PLUGIN_ID)).rejects.toThrow('boom')
    expect(k.host.listLoaded()).not.toContain(PLUGIN_ID)
  })

  it('teardown awaits the exit of workers the host never owned, BEFORE removing the temp dir', async () => {
    k = createTestKernel()
    k.writePlugin({ id: PLUGIN_ID })
    // loader.load() directly: worker is spawned but never registered with the host
    // (the panel-plugin e2e pattern that used to race the temp-dir cleanup).
    const { channel } = await k.loader.load(PLUGIN_ID)
    const worker = (channel as unknown as { worker: Worker }).worker
    expect(worker.threadId).toBeGreaterThan(0)

    const dir = k.tmpDir
    await k.teardown()

    expect(worker.threadId).toBe(-1) // worker thread has exited
    expect(fs.existsSync(dir)).toBe(false)
  })

  it('teardown right after spawn never lets a booting worker hit a deleted entry file', async () => {
    const errors: unknown[] = []
    const onErr = (e: unknown): void => void errors.push(e)
    process.on('uncaughtException', onErr)
    try {
      for (let i = 0; i < 15; i++) {
        const kk = createTestKernel()
        kk.writePlugin({ id: PLUGIN_ID })
        const { channel } = await kk.loader.load(PLUGIN_ID)
        const worker = (channel as unknown as { worker: Worker }).worker
        await kk.teardown() // immediately: worker may still be booting
        expect(worker.threadId).toBe(-1)
      }
      await new Promise((r) => setTimeout(r, 200))
    } finally {
      process.off('uncaughtException', onErr)
    }
    expect(errors).toEqual([])
  })

  it('teardown is idempotent', async () => {
    k = createTestKernel()
    await k.teardown()
    await expect(k.teardown()).resolves.toBeUndefined()
  })
})
