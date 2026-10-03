import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

vi.mock('worker_threads', async () =>
  (await import('../helpers/waFakes')).createWorkerThreadsModule()
)

import { WAWorkerBridge } from '../../workers/bridge/WAWorkerBridge'
import { WorkerCommandRouter } from '../../workers/whatsapp/routing/workerCommandRouter'
import type { WorkerConnectionManager } from '../../workers/whatsapp/socket/workerConnectionManager'
import type { WorkerCommandMessage } from '../../workers/whatsapp/whatsappWorker.types'
import {
  FakeWorker,
  createFakeEventBus,
  createFakeWindowEmitter,
  fakeParentPort
} from '../helpers/waFakes'

/**
 * F-WA-3 / B-WA-09 / R-WA-05: graceful worker shutdown.
 * Bridge half: stop() asks the worker to shut down, waits (bounded) for the ack, then terminates.
 * Worker half: the `shutdown` command closes the socket and disconnects Prisma, then acks.
 */

const tick = (): Promise<void> => vi.advanceTimersByTimeAsync(0)

// Pinned known bug (B-WA-09): flipped to plain `it` by the fix commit.
const bug = it.fails

const SHUTDOWN = { type: 'shutdown', correlationId: 's1' } as unknown as WorkerCommandMessage

describe('F-WA-3 bridge: stop() is graceful (B-WA-09)', () => {
  let bridge: WAWorkerBridge
  let worker: FakeWorker

  beforeEach(() => {
    vi.useFakeTimers()
    FakeWorker.reset()
    bridge = new WAWorkerBridge('/w.js', '/db', '/ud', () => createFakeEventBus(), createFakeWindowEmitter())
    vi.spyOn(console, 'log').mockImplementation(() => undefined)
    vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
    bridge.start(true, false)
    worker = FakeWorker.last
  })
  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  bug('posts a shutdown command and does not terminate until the worker acks', async () => {
    const stopped = bridge.stop()
    await tick()
    const cmd = worker.commandOfType('shutdown' as WorkerCommandMessage['type'])
    expect(worker.terminate).not.toHaveBeenCalled()
    worker.reply(cmd.correlationId, { status: 'success' })
    await stopped
    expect(worker.terminate).toHaveBeenCalledTimes(1)
    expect(bridge.isRunning()).toBe(false)
  })

  bug('terminates after a bounded timeout when the worker never acks', async () => {
    const stopped = bridge.stop()
    await tick()
    expect(worker.terminate).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(3_100)
    await stopped
    expect(worker.terminate).toHaveBeenCalledTimes(1)
    expect(bridge.isRunning()).toBe(false)
  })

  bug('terminates even if the worker answers shutdown with an error', async () => {
    const stopped = bridge.stop()
    await tick()
    worker.replyError(worker.commandOfType('shutdown' as WorkerCommandMessage['type']).correlationId, 'boom')
    await stopped
    expect(worker.terminate).toHaveBeenCalledTimes(1)
  })

  it('an intentional stop is not reported as an unexpected exit', async () => {
    const onExit = vi.fn()
    bridge.setUnexpectedExitHandler(onExit)
    const stopped = bridge.stop()
    await tick()
    await vi.advanceTimersByTimeAsync(3_100)
    await stopped
    worker._triggerExit(1)
    expect(onExit).not.toHaveBeenCalled()
  })

  it('a worker that exits during shutdown does not hang stop()', async () => {
    const stopped = bridge.stop()
    await tick()
    worker._triggerExit(0)
    await stopped
    expect(bridge.isRunning()).toBe(false)
  })

  bug('concurrent stop() calls shut the worker down once', async () => {
    const a = bridge.stop()
    const b = bridge.stop()
    await tick()
    worker.reply(worker.commandOfType('shutdown' as WorkerCommandMessage['type']).correlationId, { status: 'success' })
    await Promise.all([a, b])
    expect(worker.commands.filter((c) => (c.type as string) === 'shutdown')).toHaveLength(1)
    expect(worker.terminate).toHaveBeenCalledTimes(1)
  })
})

describe('F-WA-3 worker: shutdown command (R-WA-05)', () => {
  beforeEach(() => {
    fakeParentPort.reset()
    vi.spyOn(console, 'log').mockImplementation(() => undefined)
    vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
  })
  afterEach(() => vi.restoreAllMocks())

  function setup(disconnect: () => Promise<void> = async () => undefined) {
    const order: string[] = []
    const prisma = {
      $disconnect: vi.fn(async () => {
        order.push('disconnect')
        await disconnect()
      })
    }
    const connectionManager = {
      getSocket: vi.fn(() => null),
      getRepos: vi.fn(() => null),
      setup: vi.fn(),
      connect: vi.fn(async () => undefined),
      shutdown: vi.fn(() => {
        order.push('shutdown')
      })
    }
    const bootstrap = vi.fn(async () => ({ prisma, repos: {} }))
    const router = new WorkerCommandRouter(
      connectionManager as unknown as WorkerConnectionManager,
      bootstrap as unknown as ConstructorParameters<typeof WorkerCommandRouter>[1]
    )
    const init = () =>
      router.handleCommand({
        type: 'init',
        correlationId: 'init-call',
        payload: { dbPath: '/db', userDataPath: '/ud', syncFullHistory: false, shouldSyncHistory: false }
      })
    return { router, prisma, connectionManager, order, init }
  }

  const ack = { type: 'reply', correlationId: 's1', payload: { result: { status: 'success' } } }

  bug('closes the connection, then disconnects Prisma, then acks success', async () => {
    const { router, prisma, connectionManager, order, init } = setup()
    await init()
    fakeParentPort.reset()
    await router.handleCommand(SHUTDOWN)
    expect(connectionManager.shutdown).toHaveBeenCalledTimes(1)
    expect(prisma.$disconnect).toHaveBeenCalledTimes(1)
    expect(order).toEqual(['shutdown', 'disconnect'])
    expect(fakeParentPort.posted).toEqual([ack])
  })

  bug('before init (no prisma yet) still closes the connection and acks', async () => {
    const { router, connectionManager } = setup()
    await router.handleCommand(SHUTDOWN)
    expect(connectionManager.shutdown).toHaveBeenCalledTimes(1)
    expect(fakeParentPort.posted).toEqual([ack])
  })

  bug('a failing prisma.$disconnect is logged but still acks', async () => {
    const { router, init } = setup(async () => {
      throw new Error('disconnect failed')
    })
    await init()
    fakeParentPort.reset()
    await router.handleCommand(SHUTDOWN)
    expect(fakeParentPort.posted).toEqual([ack])
  })
})
