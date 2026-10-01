import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

vi.mock('worker_threads', async () =>
  (await import('../../helpers/waFakes')).createWorkerThreadsModule()
)

import { WAWorkerBridge } from '../../../workers/bridge/WAWorkerBridge'
import { WorkerCommandRouter } from '../../../workers/whatsapp/routing/workerCommandRouter'
import type { WorkerConnectionManager } from '../../../workers/whatsapp/socket/workerConnectionManager'
import { WorkerEventBusAdapter } from '../../../workers/whatsapp/events/WorkerEventBusAdapter'
import { restoreBuffers, sanitizeForPostMessage } from '../../../workers/whatsapp/utils/workerUtils'
import {
  FakeWorker,
  createFakeBaileysSocket,
  createFakeEventBus,
  createFakeEventPublisher,
  createFakeWindowEmitter,
  fakeParentPort,
  flushPromises
} from '../../helpers/waFakes'
import type { WorkerEventMessage } from '../../../workers/whatsapp/whatsappWorker.types'

/**
 * N-02 / R-WA-01: wire-level contracts.
 *  1. workerUtils sanitize/restore (the structured-clone safety layer).
 *  2. WorkerEventBusAdapter (worker -> publisher ordering and stripping).
 *  3. Bridge <-> router round trip over the fake ports (command shape is
 *     accepted by the router; reply shape is accepted by the bridge).
 */

describe('workerUtils wire helpers', () => {
  it('sanitizeForPostMessage: primitives pass through; bigint -> number; function/symbol -> undefined', () => {
    expect(sanitizeForPostMessage(1)).toBe(1)
    expect(sanitizeForPostMessage('s')).toBe('s')
    expect(sanitizeForPostMessage(null)).toBeNull()
    expect(sanitizeForPostMessage(undefined)).toBeUndefined()
    expect(sanitizeForPostMessage(BigInt(12))).toBe(12)
    expect(sanitizeForPostMessage(() => 1)).toBeUndefined()
    expect(sanitizeForPostMessage(Symbol('x'))).toBeUndefined()
  })

  it('sanitizeForPostMessage: drops function/symbol props from objects, nulls them in arrays', () => {
    expect(sanitizeForPostMessage({ a: 1, f: () => 1, s: Symbol('x'), n: BigInt(2) })).toEqual({ a: 1, n: 2 })
    expect(sanitizeForPostMessage([1, () => 1, 3])).toEqual([1, null, 3])
  })

  it('sanitizeForPostMessage: Buffers/Uint8Arrays are returned by identity; Date and RegExp are cloned', () => {
    const buf = Buffer.from([1, 2])
    const u8 = new Uint8Array([3])
    const d = new Date(1000)
    const re = /x/gi
    const out = sanitizeForPostMessage({ buf, u8, d, re }) as Record<string, unknown>
    expect(out.buf).toBe(buf)
    expect(out.u8).toBe(u8)
    expect(out.d).toEqual(d)
    expect(out.d).not.toBe(d)
    expect((out.re as RegExp).source).toBe('x')
    expect(out.re).not.toBe(re)
  })

  it('sanitizeForPostMessage: cycles are dropped (undefined) rather than recursing forever', () => {
    const a: Record<string, unknown> = { name: 'a' }
    a.self = a
    expect(sanitizeForPostMessage(a)).toEqual({ name: 'a' })
    const arr: unknown[] = [1]
    arr.push(arr)
    expect(sanitizeForPostMessage(arr)).toEqual([1, null])
  })

  it('sanitizeForPostMessage: the same object referenced twice (not a cycle) is kept both times', () => {
    const shared = { v: 1 }
    expect(sanitizeForPostMessage({ a: shared, b: shared })).toEqual({ a: { v: 1 }, b: { v: 1 } })
  })

  it('sanitizeForPostMessage: bigint beyond 2^53 silently loses precision (pinned)', () => {
    expect(sanitizeForPostMessage(BigInt('9007199254740993'))).toBe(9007199254740992)
  })

  it('restoreBuffers: Uint8Array -> Buffer sharing the same bytes, recursively through objects and arrays', () => {
    const out = restoreBuffers({ a: [new Uint8Array([1, 2]), { b: new Uint8Array([3]) }], s: 'x', n: 1 }) as {
      a: [Buffer, { b: Buffer }]
      s: string
      n: number
    }
    expect(Buffer.isBuffer(out.a[0])).toBe(true)
    expect(Array.from(out.a[0])).toEqual([1, 2])
    expect(Buffer.isBuffer(out.a[1].b)).toBe(true)
    expect(out.s).toBe('x')
    expect(out.n).toBe(1)
  })

  it('restoreBuffers: primitives, null and undefined pass through', () => {
    expect(restoreBuffers(null)).toBeNull()
    expect(restoreBuffers(undefined)).toBeUndefined()
    expect(restoreBuffers(5)).toBe(5)
    expect(restoreBuffers('s')).toBe('s')
  })

  it('restoreBuffers: a Node Buffer (already a Uint8Array) comes back as a Buffer with equal bytes', () => {
    const out = restoreBuffers(Buffer.from([7, 8])) as Buffer
    expect(Buffer.isBuffer(out)).toBe(true)
    expect(Array.from(out)).toEqual([7, 8])
  })

  it('restoreBuffers: JSON-serialised Buffers ({type:"Buffer",data:[..]}) are NOT revived (pinned)', () => {
    const json = { type: 'Buffer', data: [1, 2] }
    expect(restoreBuffers({ x: json })).toEqual({ x: json })
  })

  it('sanitize then restore round-trips a Buffer-bearing payload with bigint flattened', () => {
    const wire = sanitizeForPostMessage({ media: Buffer.from([1, 2, 3]), size: BigInt(3), f: () => 0 })
    const back = restoreBuffers(wire) as { media: Buffer; size: number }
    expect(Array.from(back.media)).toEqual([1, 2, 3])
    expect(back.size).toBe(3)
    expect(back).not.toHaveProperty('f')
  })
})

describe('WorkerEventBusAdapter contract', () => {
  it('publishes a sanitized payload to the publisher BEFORE awaiting the wrapped bus emit', async () => {
    const order: string[] = []
    const publisher = createFakeEventPublisher()
    publisher.publish.mockImplementation(() => {
      order.push('publish')
    })
    const wrapped = createFakeEventBus()
    wrapped.emit.mockImplementation(async () => {
      order.push('emit')
    })
    const adapter = new WorkerEventBusAdapter(wrapped, publisher)

    await adapter.emit('chats.upsert' as never, { n: BigInt(1) } as never)

    expect(order).toEqual(['publish', 'emit'])
    expect(publisher.events).toEqual([['chats.upsert', { n: 1 }]])
    // the wrapped bus receives the ORIGINAL (unsanitized) data
    expect(wrapped.emit).toHaveBeenCalledWith('chats.upsert', { n: BigInt(1) })
  })

  it('strips `sock` from the published copy but passes it to the wrapped bus', async () => {
    const publisher = createFakeEventPublisher()
    const wrapped = createFakeEventBus()
    const sock = createFakeBaileysSocket()
    const adapter = new WorkerEventBusAdapter(wrapped, publisher)

    await adapter.emit('message:incoming' as never, { id: 'a', sock } as never)

    expect(publisher.events).toEqual([['message:incoming', { id: 'a' }]])
    expect(wrapped.emit).toHaveBeenCalledWith('message:incoming', { id: 'a', sock })
  })

  it('app-state:sync is never published to the main process but is still emitted locally', async () => {
    const publisher = createFakeEventPublisher()
    const wrapped = createFakeEventBus()
    const adapter = new WorkerEventBusAdapter(wrapped, publisher)

    await adapter.emit('app-state:sync' as never, { x: 1 } as never)

    expect(publisher.publish).not.toHaveBeenCalled()
    expect(wrapped.emit).toHaveBeenCalledTimes(1)
  })

  it('on/off/removeAllListeners delegate to the wrapped bus and on/off return the adapter', () => {
    const publisher = createFakeEventPublisher()
    const wrapped = createFakeEventBus()
    const adapter = new WorkerEventBusAdapter(wrapped, publisher)
    const h = vi.fn()
    expect(adapter.on('chats.upsert' as never, h as never)).toBe(adapter)
    expect(adapter.off('chats.upsert' as never, h as never)).toBe(adapter)
    adapter.removeAllListeners()
    expect(wrapped.on).toHaveBeenCalledWith('chats.upsert', h)
    expect(wrapped.off).toHaveBeenCalledWith('chats.upsert', h)
    expect(wrapped.removeAllListeners).toHaveBeenCalled()
  })

  it('if the wrapped bus rejects, publish has already happened and the rejection propagates', async () => {
    const publisher = createFakeEventPublisher()
    const wrapped = createFakeEventBus()
    wrapped.emit.mockRejectedValue(new Error('local handler failed'))
    const adapter = new WorkerEventBusAdapter(wrapped, publisher)
    await expect(adapter.emit('chats.upsert' as never, {} as never)).rejects.toThrow('local handler failed')
    expect(publisher.publish).toHaveBeenCalledTimes(1)
  })
})

describe('bridge <-> router round trip over fake ports', () => {
  beforeEach(() => {
    FakeWorker.reset()
    fakeParentPort.reset()
    vi.spyOn(console, 'log').mockImplementation(() => undefined)
    vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
  })
  afterEach(() => vi.restoreAllMocks())

  /** Wire: bridge -> (postMessage) -> router -> (parentPort.postMessage) -> bridge. */
  function wire() {
    const sock = createFakeBaileysSocket()
    const skipSync = vi.fn(async () => 'deferred')
    const connectionManager = {
      getSocket: () => sock,
      getRepos: () => ({ historySyncManager: { skipSync } }),
      setup: vi.fn(),
      connect: vi.fn(async () => undefined)
    }
    const router = new WorkerCommandRouter(
      connectionManager as unknown as WorkerConnectionManager,
      (async () => ({ prisma: {}, repos: {} })) as unknown as ConstructorParameters<typeof WorkerCommandRouter>[1]
    )
    const bridge = new WAWorkerBridge('/w.js', '/db', '/ud', () => createFakeEventBus(), createFakeWindowEmitter())
    bridge.start(true, true)
    const worker = FakeWorker.last
    // main -> worker
    worker.postMessage.mockImplementation((msg) => {
      void router.handleCommand(msg)
    })
    // worker -> main
    fakeParentPort.postMessage.mockImplementation((msg: WorkerEventMessage) => {
      worker._emitMessage(msg)
    })
    return { bridge, sock, worker, skipSync, connectionManager }
  }

  it('init: start() posts init; the router connects and its reply is accepted (and ignored) by the bridge', async () => {
    const { connectionManager } = wire()
    // the init was posted before the mock implementation was attached; replay it
    const init = FakeWorker.last.commands[0]
    FakeWorker.last.postMessage(init)
    await flushPromises()
    expect(connectionManager.connect).toHaveBeenCalled()
    expect(fakeParentPort.posted).toEqual([
      { type: 'reply', correlationId: 'init-call', payload: { result: { status: 'initialized' } } }
    ])
  })

  it('send_message / chat_modify / group_metadata / profile pic / lid / fetch history resolve end to end', async () => {
    const { bridge, sock } = wire()
    sock.sendMessage.mockResolvedValue({ key: { id: 'S' } })
    sock.fetchMessageHistory.mockResolvedValue('RQ')

    await expect(bridge.sendMessage('j', { text: 'hi' })).resolves.toEqual({ key: { id: 'S' } })
    await expect(bridge.chatModify({ archive: true }, 'j')).resolves.toBeUndefined()
    await expect(bridge.groupMetadata('g@g.us')).resolves.toMatchObject({ id: 'g@g.us' })
    await expect(bridge.profilePictureUrl('j', 'image')).resolves.toBe('https://pp.example/img.jpg')
    await expect(bridge.signalRepository.lidMapping.getPNForLID('l')).resolves.toBe('2222@s.whatsapp.net')
    await expect(
      bridge.fetchMessageHistory({ count: 1, jid: 'j', oldestMsgId: 'm', oldestMsgFromMe: false, oldestMsgTimestampMs: 9 })
    ).resolves.toEqual({ requestId: 'RQ' })
    expect(sock.chatModify).toHaveBeenCalledWith({ archive: true }, 'j')
  })

  it('a socket error comes back as a rejected bridge promise with the same message', async () => {
    const { bridge, sock } = wire()
    sock.logout.mockRejectedValue(new Error('already logged out'))
    await expect(bridge.logout()).rejects.toThrow('already logged out')
  })

  it('skip_sync deferred reply reaches the bridge but skipSync() drops it (B-WA-13)', async () => {
    const { bridge, skipSync } = wire()
    await expect(bridge.skipSync()).resolves.toBeUndefined()
    expect(skipSync).toHaveBeenCalledTimes(1)
    expect(fakeParentPort.lastPosted).toEqual({
      type: 'reply',
      correlationId: expect.stringMatching(/^cmd-/),
      payload: { result: { status: 'deferred' } }
    })
  })

  it('group_fetch_all end to end yields {groups}, not a jid map (B-WA-15)', async () => {
    const { bridge, sock } = wire()
    sock.groupFetchAllParticipating.mockResolvedValue({ 'g@g.us': { id: 'g@g.us' } })
    await expect(bridge.groupFetchAllParticipating()).resolves.toEqual({ groups: { 'g@g.us': { id: 'g@g.us' } } })
  })
})
