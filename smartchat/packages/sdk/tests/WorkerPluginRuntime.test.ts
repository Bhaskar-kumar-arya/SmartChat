import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { MessageChannel, MessagePort } from 'node:worker_threads'
import { WorkerPluginRuntime } from '../src/channel'
import { PluginManifest } from '../src/manifest'

describe('WorkerPluginRuntime', () => {
  let port1: MessagePort
  let port2: MessagePort
  let manifest: PluginManifest

  beforeEach(() => {
    const channel = new MessageChannel()
    port1 = channel.port1
    port2 = channel.port2

    manifest = {
      id: 'com.example.test',
      name: 'Test Plugin',
      version: '1.0.0',
      apiVersion: '2',
      main: 'index.js',
      permissions: ['chats:read', 'messages:send', 'ai:chat'],
      contributions: {}
    }
  })

  afterEach(() => {
    port1.close()
    port2.close()
  })

  it('should format and send kernel request over port when calling API method', async () => {
    const runtime = new WorkerPluginRuntime(port1, manifest)
    const ctx = runtime.getContext()

    const requestPromise = ctx.chats!.getList(1, 20)

    await new Promise<void>((resolve) => {
      port2.once('message', (msg) => {
        expect(msg).toMatchObject({
          type: 'kernel:chats:getList',
          payload: { page: 1, limit: 20 }
        })
        expect(typeof msg.id).toBe('string')

        // Respond back as kernel
        port2.postMessage({
          id: msg.id,
          ok: true,
          payload: [{ jid: '123@s.whatsapp.net', name: 'Alice' }]
        })
        resolve()
      })
    })

    const chats = await requestPromise
    expect(chats).toEqual([{ jid: '123@s.whatsapp.net', name: 'Alice' }])
  })

  it('should reject API call promise when KernelResponse ok is false', async () => {
    const runtime = new WorkerPluginRuntime(port1, manifest)
    const ctx = runtime.getContext()

    const requestPromise = ctx.messages!.send('123@s.whatsapp.net', 'Hello')

    port2.once('message', (msg) => {
      port2.postMessage({
        id: msg.id,
        ok: false,
        error: {
          code: 'PERMISSION_DENIED',
          message: 'Permission denied for messages:send',
          permission: 'messages:send'
        }
      })
    })

    await expect(requestPromise).rejects.toThrow('Permission denied for messages:send')
  })

  it('should register chat action handler and execute when kernel sends execution message', async () => {
    const runtime = new WorkerPluginRuntime(port1, manifest)
    const ctx = runtime.getContext()

    const actionSpy = vi.fn().mockResolvedValue(undefined)
    ctx.contributions.registerChatAction?.('archive-chat', actionSpy)

    // Simulate kernel sending contribution execution request to plugin
    const executionReq = {
      id: 'req-1',
      type: 'contribution:execute:chat-action',
      payload: { id: 'archive-chat', context: { chatJid: '123@s.whatsapp.net' } }
    }

    const responsePromise = new Promise<any>((resolve) => {
      const listener = (res: any) => {
        if (res.id === 'req-1') {
          port2.off('message', listener)
          resolve(res)
        }
      }
      port2.on('message', listener)
    })

    port2.postMessage(executionReq)

    const res = await responsePromise
    expect(res).toMatchObject({
      id: 'req-1',
      ok: true
    })
    expect(actionSpy).toHaveBeenCalledWith({ chatJid: '123@s.whatsapp.net' })
  })

  it('should post log messages over port via ctx.log', async () => {
    const runtime = new WorkerPluginRuntime(port1, manifest)
    const ctx = runtime.getContext()

    const logPromise = new Promise<any>((resolve) => {
      port2.once('message', (msg) => {
        resolve(msg)
      })
    })

    ctx.log.info('System operational', { status: 'ok' })

    const logMsg = await logPromise
    expect(logMsg).toMatchObject({
      type: 'kernel:log',
      payload: {
        level: 'info',
        message: 'System operational',
        data: [{ status: 'ok' }]
      }
    })
  })

  it('should reject requests that time out after specified deadline', async () => {
    const runtime = new WorkerPluginRuntime(port1, manifest, { requestTimeoutMs: 100 })
    const ctx = runtime.getContext()

    const requestPromise = ctx.ai!.chat('Hello AI')

    await expect(requestPromise).rejects.toThrow(/timed out/i)
  })

  it('should allow registering custom incoming handlers and dispatching requests through the handler registry map', async () => {
    const runtime = new WorkerPluginRuntime(port1, manifest)

    runtime.registerIncomingHandler('custom:ping', async (req) => {
      return { pong: true, echoes: req.payload }
    })

    const customReq = {
      id: 'req-custom-1',
      type: 'custom:ping',
      payload: { hello: 'world' }
    }

    const responsePromise = new Promise<any>((resolve) => {
      const listener = (res: any) => {
        if (res.id === 'req-custom-1') {
          port2.off('message', listener)
          resolve(res)
        }
      }
      port2.on('message', listener)
    })

    port2.postMessage(customReq)

    const res = await responsePromise
    expect(res).toEqual({
      id: 'req-custom-1',
      ok: true,
      payload: { pong: true, echoes: { hello: 'world' } }
    })
  })

  it('should respond with NOT_FOUND error for unknown incoming request types', async () => {
    void new WorkerPluginRuntime(port1, manifest)

    const unknownReq = {
      id: 'req-unknown-1',
      type: 'unknown:request:type',
      payload: {}
    }

    const responsePromise = new Promise<any>((resolve) => {
      const listener = (res: any) => {
        if (res.id === 'req-unknown-1') {
          port2.off('message', listener)
          resolve(res)
        }
      }
      port2.on('message', listener)
    })

    port2.postMessage(unknownReq)

    const res = await responsePromise
    expect(res).toMatchObject({
      id: 'req-unknown-1',
      ok: false,
      error: {
        code: 'NOT_FOUND',
        message: "Unhandled incoming type 'unknown:request:type'"
      }
    })
  })

  it('rejects all pending requests when the port closes (P2-S12-07)', async () => {
    const runtime = new WorkerPluginRuntime(port1, manifest, { requestTimeoutMs: 0 })
    const ctx = runtime.getContext()
    const pending = ctx.ui!.showForm({ title: 't', fields: [] })
    port1.close()
    await expect(pending).rejects.toThrow(/channel closed/i)
  })

  it('clears untracked scheduler timers on plugin:deactivate (P2-S12-08)', async () => {
    const runtime = new WorkerPluginRuntime(port1, manifest)
    const ctx = runtime.getContext()
    const fn = vi.fn()
    ctx.scheduler!.setInterval(10, fn) // disposer intentionally discarded

    const responsePromise = new Promise<any>((resolve) => {
      const listener = (res: any) => {
        if (res.id === 'deact-1') { port2.off('message', listener); resolve(res) }
      }
      port2.on('message', listener)
    })
    port2.postMessage({ id: 'deact-1', type: 'plugin:deactivate', payload: {} })
    await responsePromise

    fn.mockClear()
    await new Promise((r) => setTimeout(r, 60))
    expect(fn).not.toHaveBeenCalled()
  })

  it('scheduler API no longer exposes the dead onCron method (P2-S12-08)', () => {
    const runtime = new WorkerPluginRuntime(port1, manifest)
    const ctx = runtime.getContext()
    expect((ctx.scheduler as unknown as Record<string, unknown>).onCron).toBeUndefined()
  })

  it('should not time out showOverlay requests waiting for user interaction even with short requestTimeoutMs', async () => {
    const runtime = new WorkerPluginRuntime(port1, manifest, { requestTimeoutMs: 50 })
    const ctx = runtime.getContext()

    let requestId = ''
    port2.once('message', (msg) => {
      expect(msg.type).toBe('kernel:ui:showOverlay')
      requestId = msg.id
      // Simulate slow user interaction that takes longer than 50ms (e.g. 100ms)
      setTimeout(() => {
        port2.postMessage({
          id: requestId,
          ok: true,
          payload: { text: 'Submitted text after user delay' }
        })
      }, 100)
    })

    const overlayPromise = ctx.ui!.showOverlay({ panel: 'test.html' })
    const result = await overlayPromise
    expect(result).toEqual({ text: 'Submitted text after user delay' })
  })
})
