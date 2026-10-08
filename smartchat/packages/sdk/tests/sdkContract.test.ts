import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import * as fs from 'node:fs'
import * as path from 'node:path'
import { MessageChannel, MessagePort } from 'node:worker_threads'
import { WorkerPluginRuntime } from '../src/channel'
import { PluginManifest } from '../src/manifest'

/**
 * R-KRN-11 — pins the plugin SDK <-> kernel contract (CONTRACT: plugin SDK API).
 * Cases marked `it.fails` pin pre-fix behaviour and flip in the fix commit.
 */

interface Reply {
  id?: string
  ok?: boolean
  error?: { code?: string; message?: string }
  payload?: unknown
}

type RegisterToolFn = (def: {
  name: string
  description: string
  schema: object
  execute?: (args: Record<string, unknown>) => Promise<{ text: string }>
}) => Promise<unknown>

describe('SDK contract (R-KRN-11)', () => {
  let port1: MessagePort
  let port2: MessagePort
  let manifest: PluginManifest

  beforeEach(() => {
    const channel = new MessageChannel()
    port1 = channel.port1
    port2 = channel.port2
    manifest = {
      id: 'com.example.contract',
      name: 'Contract',
      version: '1.0.0',
      apiVersion: '2',
      main: 'index.js',
      permissions: ['ai:tools:register'],
      contributions: {}
    }
  })

  afterEach(() => {
    port1.close()
    port2.close()
  })

  /** Send a kernel->plugin request and resolve with the plugin's reply. */
  function kernelRequest(id: string, type: string, payload: unknown): Promise<Reply> {
    return new Promise<Reply>((resolve) => {
      const listener = (res: Reply): void => {
        if (res.id === id) {
          port2.off('message', listener)
          resolve(res)
        }
      }
      port2.on('message', listener)
      port2.postMessage({ id, type, payload })
    })
  }

  describe('slash command args', () => {
    async function runSlash(text: string, args: string | undefined): Promise<string[]> {
      const runtime = new WorkerPluginRuntime(port1, manifest)
      const spy = vi.fn().mockResolvedValue(undefined)
      runtime.getContext().contributions.registerSlashCommand?.('ping', spy)
      await kernelRequest('s1', 'contribution:execute:slash-command', {
        id: 'ping',
        name: 'ping',
        args,
        context: { jid: '123@s.whatsapp.net', text }
      })
      return spy.mock.calls[0] as string[]
    }

    it('derives args from the typed text when the host sends an empty args', async () => {
      const [args] = await runSlash('/ping hello  world ', '')
      expect(args).toBe('hello  world')
    })

    it('keeps an explicit non-empty args untouched', async () => {
      const [args] = await runSlash('/ping ignored', 'explicit')
      expect(args).toBe('explicit')
    })

    it('passes empty args for a bare command', async () => {
      const [args] = await runSlash('/ping', '')
      expect(args).toBe('')
    })
  })

  describe('ctx.ai.registerTool', () => {
    it('sends kernel:ai:registerTool with name, description and schema', async () => {
      const runtime = new WorkerPluginRuntime(port1, manifest)
      const registerTool = (runtime.getContext().ai as unknown as { registerTool?: RegisterToolFn }).registerTool
      expect(typeof registerTool).toBe('function')

      const seen = new Promise<{ type: string; payload: unknown; id: string }>((resolve) => {
        port2.once('message', (m) => resolve(m))
      })
      const p = registerTool!({ name: 't', description: 'd', schema: { type: 'object' } })
      const msg = await seen
      expect(msg.type).toBe('kernel:ai:registerTool')
      expect(msg.payload).toEqual({ name: 't', description: 'd', schema: { type: 'object' } })
      port2.postMessage({ id: msg.id, ok: true, payload: { success: true } })
      await p
    })

    it('runs the optional execute callback for contribution:execute:ai-tool', async () => {
      const runtime = new WorkerPluginRuntime(port1, manifest)
      const registerTool = (runtime.getContext().ai as unknown as { registerTool?: RegisterToolFn }).registerTool
      port2.once('message', (m) => port2.postMessage({ id: m.id, ok: true, payload: {} }))
      await registerTool!({
        name: 't',
        description: 'd',
        schema: {},
        execute: async (a) => ({ text: `got ${String(a.x)}` })
      })
      const res = await kernelRequest('a1', 'contribution:execute:ai-tool', { name: 't', args: { x: 1 } })
      expect(res).toMatchObject({ ok: true, payload: { text: 'got 1' } })
    })

    it('still supports contributions.registerAITool executors', async () => {
      const runtime = new WorkerPluginRuntime(port1, manifest)
      runtime.getContext().contributions.registerAITool?.('legacy', async () => ({ text: 'ok' }))
      const res = await kernelRequest('a2', 'contribution:execute:ai-tool', { name: 'legacy', args: {} })
      expect(res).toMatchObject({ ok: true, payload: { text: 'ok' } })
    })
  })

  describe('declared-but-unimplemented contribution APIs', () => {
    it('chat badge computers still work (used by sample plugins; documented as not rendered)', async () => {
      const runtime = new WorkerPluginRuntime(port1, manifest)
      runtime.getContext().contributions.registerChatBadge?.('b', async (jid) => ({ text: jid }))
      const res = await kernelRequest('b1', 'contribution:compute:chat-badge', { id: 'b', chatJid: 'x@g.us' })
      expect(res).toMatchObject({ ok: true, payload: { text: 'x@g.us' } })
    })

    it('no longer exposes importAPI / exposeAPI / completion / send-interceptor registration', () => {
      const runtime = new WorkerPluginRuntime(port1, manifest)
      const keys = Object.keys(runtime.getContext().contributions)
      for (const removed of ['importAPI', 'exposeAPI', 'registerCompletionProvider', 'registerMessageSendInterceptor']) {
        expect(keys).not.toContain(removed)
      }
    })

    it('does not answer the removed completion / pipeline kernel requests', async () => {
      new WorkerPluginRuntime(port1, manifest)
      const a = await kernelRequest('c1', 'contribution:execute:completion-provider', { id: 'p', context: {} })
      const b = await kernelRequest('c2', 'contribution:execute:message-send-pipeline', { id: 'p', payload: {} })
      expect(a.error?.message).toMatch(/Unhandled incoming type/)
      expect(b.error?.message).toMatch(/Unhandled incoming type/)
    })
  })

  describe('PluginEventMap vs WAEventMap', () => {
    const root = path.resolve(__dirname, '..', '..', '..')
    const keysIn = (text: string): string[] => [...text.matchAll(/^\s+'([a-z-]+:[a-z.:-]+)':/gm)].map((m) => m[1])

    const waKeys = (): Set<string> => {
      const dir = path.join(root, 'src/main/services/whatsapp/events')
      const keys = new Set<string>()
      for (const f of fs.readdirSync(dir)) {
        const src = fs.readFileSync(path.join(dir, f), 'utf8')
        for (const m of src.matchAll(/export interface \w+EventMap \{([\s\S]*?)\n\}/g)) {
          keysIn(m[1]).forEach((k) => keys.add(k))
        }
      }
      return keys
    }

    const pluginKeys = (): string[] => {
      const src = fs.readFileSync(path.join(root, 'packages/sdk/src/events.ts'), 'utf8')
      const block = /export interface PluginEventMap[^{]*\{([\s\S]*?)\n\}/.exec(src)
      return block ? keysIn(block[1]) : []
    }

    it('sanity: the parsers find events', () => {
      expect(waKeys().has('message:incoming')).toBe(true)
      expect(pluginKeys()).toContain('message:incoming')
    })

    it('every named PluginEventMap event is a real WAEventMap event', () => {
      const wa = waKeys()
      expect(pluginKeys().filter((k) => !wa.has(k))).toEqual([])
    })
  })
})
