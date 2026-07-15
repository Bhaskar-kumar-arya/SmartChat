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

  it('should route domain events to bus and window emitter', () => {
    bridge.start(true, true)

    ;(Worker as any)._triggerMessage({
      type: 'domain_event',
      payload: {
        event: 'wa-qr',
        data: 'qr-code-data'
      }
    })

    expect(mockWindowEmitter.send).toHaveBeenCalledWith('wa-qr', 'qr-code-data')
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

  it('stop should terminate worker', async () => {
    bridge.start(true, true)
    const workerMock = (Worker as any)._getMockInstances()
    
    await bridge.stop()
    
    expect(workerMock.terminate).toHaveBeenCalled()
    await expect(bridge.logout()).rejects.toThrow('Worker thread is not running')
  })
})
