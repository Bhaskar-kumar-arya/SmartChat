import { describe, it, expect, vi, beforeEach, Mocked } from 'vitest'
import { WAWorkerBridge } from '../../../workers/bridge/WAWorkerBridge'
import { IWAEventBus } from '../../../services/whatsapp/IWAEventBus'
import { IWindowEventEmitter } from '../../../workers/bridge/IWindowEventEmitter'
import { Worker } from 'worker_threads'

vi.mock('worker_threads', () => {
  const mockPostMessage = vi.fn()
  const mockTerminate = vi.fn()
  let messageHandler: any
  let errorHandler: any
  let exitHandler: any

  class MockWorker {
    on = vi.fn((event, handler) => {
      if (event === 'message') messageHandler = handler
      if (event === 'error') errorHandler = handler
      if (event === 'exit') exitHandler = handler
    })
    postMessage = mockPostMessage
    terminate = mockTerminate

    static _triggerMessage = (msg: any) => messageHandler && messageHandler(msg)
    static _triggerError = (err: any) => errorHandler && errorHandler(err)
    static _triggerExit = (code: any) => exitHandler && exitHandler(code)
    static _getMockInstances = () => ({ postMessage: mockPostMessage, terminate: mockTerminate })
  }

  return {
    Worker: MockWorker
  }
})

describe('WAWorkerBridge', () => {
  let mockBus: Mocked<IWAEventBus>
  let mockWindowEmitter: Mocked<IWindowEventEmitter>
  let bridge: WAWorkerBridge

  beforeEach(() => {
    mockBus = {
      emit: vi.fn().mockResolvedValue(undefined)
    } as any

    mockWindowEmitter = {
      send: vi.fn()
    } as any

    const getBus = vi.fn().mockReturnValue(mockBus)

    bridge = new WAWorkerBridge('path/to/worker', 'db/path', 'user/data/path', getBus, mockWindowEmitter)
    vi.clearAllMocks()
  })

  it('start should spawn worker and send init command', () => {
    bridge.start(true, true)
    
    // In our mock, Worker is a class, we access its static methods
    const workerMock = (Worker as any)._getMockInstances()

    expect(workerMock.postMessage).toHaveBeenCalledWith(expect.objectContaining({
      type: 'init',
      payload: {
        dbPath: 'db/path',
        userDataPath: 'user/data/path',
        syncFullHistory: true,
        shouldSyncHistory: true
      }
    }))
  })

  it('should route domain events to bus and window emitter', async () => {
    bridge.start(true, true)

    ;(Worker as any)._triggerMessage({
      type: 'domain_event',
      payload: {
        event: 'wa-qr',
        data: 'qr-code-data'
      }
    })

    expect(mockWindowEmitter.send).toHaveBeenCalledWith('wa-qr', 'qr-code-data')
    // bus.emit is chained on emitChain (P2-S13-03) — resolves on a later microtask.
    await new Promise((r) => setTimeout(r, 0))
    expect(mockBus.emit).toHaveBeenCalledWith('wa-qr', 'qr-code-data')
  })

  it('sendCommand should return promise resolved by reply', async () => {
    bridge.start(true, true)
    const workerMock = (Worker as any)._getMockInstances()

    const promise = bridge.profilePictureUrl('jid1', 'image')

    const postMessageCall = workerMock.postMessage.mock.calls.find((call: any) => call[0].type === 'profile_picture_url')
    expect(postMessageCall).toBeDefined()
    const correlationId = postMessageCall[0].correlationId

    ;(Worker as any)._triggerMessage({
      type: 'reply',
      correlationId,
      payload: {
        result: 'http://image.url'
      }
    })

    const result = await promise
    expect(result).toBe('http://image.url')
  })

  it('updateMediaMessage sends update_media_message command and returns result', async () => {
    bridge.start(true, true)
    const workerMock = (Worker as any)._getMockInstances()

    const dummyMsg = { key: { id: 'msg1' }, message: { imageMessage: {} } }
    const promise = bridge.updateMediaMessage(dummyMsg)

    const postMessageCall = workerMock.postMessage.mock.calls.find((call: any) => call[0].type === 'update_media_message')
    expect(postMessageCall).toBeDefined()
    expect(postMessageCall[0].payload).toEqual({ msg: dummyMsg })

    const correlationId = postMessageCall[0].correlationId

    ;(Worker as any)._triggerMessage({
      type: 'reply',
      correlationId,
      payload: {
        result: { key: { id: 'msg1' }, message: { imageMessage: { url: 'https://new.cdn' } } }
      }
    })

    const result = await promise
    expect(result).toEqual({ key: { id: 'msg1' }, message: { imageMessage: { url: 'https://new.cdn' } } })
  })

  it('stop should terminate worker', async () => {
    bridge.start(true, true)
    const workerMock = (Worker as any)._getMockInstances()

    await bridge.stop()

    expect(workerMock.terminate).toHaveBeenCalled()
    await expect(bridge.logout()).rejects.toThrow('Worker thread is not running')
  })

  it('sendCommand rejects after the command timeout when the worker never replies (S13-03)', async () => {
    vi.useFakeTimers()
    bridge.start(true, true)
    const promise = bridge.groupMetadata('jid1')
    // attach a catch synchronously so an early rejection isn't unhandled
    const settled = promise.then(() => 'ok').catch((e) => e.message)
    await vi.advanceTimersByTimeAsync(30_000)
    expect(await settled).toMatch(/timed out/i)
    vi.useRealTimers()
  })

  it('serialises bus.emit across successive worker messages (P2-S13-03)', async () => {
    let resolveFirst: () => void = () => {}
    mockBus.emit
      .mockImplementationOnce(() => new Promise<void>((r) => { resolveFirst = r }))
      .mockResolvedValue(undefined)

    bridge.start(true, true)

    ;(Worker as any)._triggerMessage({ type: 'domain_event', payload: { event: 'message:incoming', data: { id: 'a' } } })
    ;(Worker as any)._triggerMessage({ type: 'domain_event', payload: { event: 'message:edited', data: { id: 'a' } } })

    // First emit is in flight; the second must not have started yet.
    await Promise.resolve()
    expect(mockBus.emit).toHaveBeenCalledTimes(1)
    expect(mockBus.emit).toHaveBeenNthCalledWith(1, 'message:incoming', expect.objectContaining({ id: 'a' }))

    resolveFirst()
    await new Promise((r) => setTimeout(r, 0))
    expect(mockBus.emit).toHaveBeenCalledTimes(2)
    expect(mockBus.emit).toHaveBeenNthCalledWith(2, 'message:edited', expect.objectContaining({ id: 'a' }))
  })

  it('emits wa-disconnected and invokes the supervisor on unexpected worker exit (S13-04)', () => {
    const onExit = vi.fn()
    bridge.setUnexpectedExitHandler(onExit)
    bridge.start(true, true)
    ;(Worker as any)._triggerExit(1)
    expect(mockWindowEmitter.send).toHaveBeenCalledWith('wa-disconnected', { code: 1 })
    expect(onExit).toHaveBeenCalledWith(1)
  })

  it('does not treat an intentional stop() as an unexpected exit (S13-04)', async () => {
    const onExit = vi.fn()
    bridge.setUnexpectedExitHandler(onExit)
    bridge.start(true, true)
    await bridge.stop()
    ;(Worker as any)._triggerExit(0)
    expect(onExit).not.toHaveBeenCalled()
    expect(mockWindowEmitter.send).not.toHaveBeenCalledWith('wa-disconnected', expect.anything())
  })
})
