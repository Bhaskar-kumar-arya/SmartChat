import { describe, it, expect, vi, beforeEach } from 'vitest'

/**
 * Pass-2 Slice 1 regression.
 *
 * P2-S1-04: the skip_sync command replied `{status:'success'}` unconditionally,
 *           even when historySyncManager.skipSync only deferred completion
 *           (chunks still ingesting). The router must surface a distinct
 *           `{status:'deferred'}` in that case.
 */

const postMessage = vi.fn()
vi.mock('worker_threads', () => ({
  parentPort: { postMessage: (...a: unknown[]) => postMessage(...a) }
}))

import { WorkerCommandRouter } from '../../../../workers/whatsapp/routing/workerCommandRouter'

function makeRouter(skipSync: ReturnType<typeof vi.fn>) {
  const connectionManager = {
    getSocket: () => ({}),
    getRepos: () => ({ historySyncManager: { skipSync } })
  } as any
  return new WorkerCommandRouter(connectionManager, vi.fn() as any)
}

describe('WorkerCommandRouter — P2-S1-04 skip_sync deferred status', () => {
  beforeEach(() => postMessage.mockClear())

  it("replies {status:'success'} when skipSync completes", async () => {
    const router = makeRouter(vi.fn().mockResolvedValue('completed'))
    await router.handleCommand({ type: 'skip_sync', correlationId: 'c1', payload: {} } as any)

    expect(postMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'reply',
        correlationId: 'c1',
        payload: { result: { status: 'success' } }
      })
    )
  })

  it("replies {status:'deferred'} when skipSync defers completion", async () => {
    const router = makeRouter(vi.fn().mockResolvedValue('deferred'))
    await router.handleCommand({ type: 'skip_sync', correlationId: 'c2', payload: {} } as any)

    expect(postMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'reply',
        correlationId: 'c2',
        payload: { result: { status: 'deferred' } }
      })
    )
  })
})
