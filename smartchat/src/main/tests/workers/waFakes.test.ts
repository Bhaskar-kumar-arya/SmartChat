import { describe, it, expect, vi } from 'vitest'
import { WorkerEventDispatcher } from '../../workers/whatsapp/events/workerEventDispatcher'
import type { WorkerConnectionHandler } from '../../workers/whatsapp/socket/workerConnectionHandler'
import type { IWorkerBootstrap } from '../../workers/whatsapp/IWorkerBootstrap'
import { FakeBaileysEv, FakeParentPort, createFakeBaileysSocket, createFakeEventPublisher } from '../helpers/waFakes'

/** Self-tests for waFakes (N-02), plus one real consumer: WorkerEventDispatcher over a fake socket. */
describe('waFakes', () => {
  it('FakeBaileysEv.emit reaches on() listeners and process() handlers; unsubscribe works', async () => {
    const ev = new FakeBaileysEv()
    const on = vi.fn()
    const proc = vi.fn()
    ev.on('connection.update', on)
    const off = ev.process(proc)
    await ev.emit('connection.update', { connection: 'open' })
    expect(on).toHaveBeenCalledWith({ connection: 'open' })
    expect(proc).toHaveBeenCalledWith({ 'connection.update': { connection: 'open' } })
    off()
    await ev.emit('connection.update', {})
    expect(proc).toHaveBeenCalledTimes(1)
    expect(ev.processHandlerCount).toBe(0)
  })

  it('FakeBaileysEv.emitBatch delivers one process() call with all keys', async () => {
    const ev = new FakeBaileysEv()
    const proc = vi.fn()
    ev.process(proc)
    await ev.emitBatch({ 'chats.upsert': [1], 'contacts.upsert': [2] })
    expect(proc).toHaveBeenCalledTimes(1)
    expect(proc).toHaveBeenCalledWith({ 'chats.upsert': [1], 'contacts.upsert': [2] })
  })

  it('FakeParentPort routes _emitMessage to on("message") handlers and records posts', () => {
    const port = new FakeParentPort()
    const h = vi.fn()
    port.on('message', h)
    port._emitMessage({ a: 1 })
    expect(h).toHaveBeenCalledWith({ a: 1 })
    port.postMessage({ type: 'reply_error', correlationId: 'c', error: 'e' })
    expect(port.lastPosted).toEqual({ type: 'reply_error', correlationId: 'c', error: 'e' })
    port.reset()
    expect(port.posted).toEqual([])
  })

  it('createFakeEventPublisher records [event, data] tuples', () => {
    const p = createFakeEventPublisher()
    p.publish('a', 1)
    p.publish('b')
    expect(p.events).toEqual([
      ['a', 1],
      ['b', undefined]
    ])
  })

  it('WorkerEventDispatcher (consumer): routes connection.update to the connection handler and ignores everything when repos are not ready', async () => {
    const sock = createFakeBaileysSocket()
    const handleConnectionUpdate = vi.fn(async () => undefined)
    const connectionHandler = { handleConnectionUpdate } as unknown as WorkerConnectionHandler
    let repos: IWorkerBootstrap | null = null
    new WorkerEventDispatcher(() => repos, connectionHandler, () => false).register(sock)

    await sock.ev.emit('connection.update', { connection: 'open' })
    expect(handleConnectionUpdate).not.toHaveBeenCalled()

    repos = {} as unknown as IWorkerBootstrap
    await sock.ev.emit('connection.update', { connection: 'open' })
    expect(handleConnectionUpdate).toHaveBeenCalledWith({ connection: 'open' })
  })
})
