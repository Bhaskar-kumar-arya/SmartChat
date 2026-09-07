import { describe, it, expect, vi, beforeEach } from 'vitest'

const { workerInstances, FakeWorker } = vi.hoisted(() => {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { EventEmitter } = require('events') as typeof import('events')
  const instances: Array<InstanceType<typeof FW>> = []
  class FW extends EventEmitter {
    postMessage = vi.fn()
    terminate = vi.fn()
    constructor() {
      super()
      instances.push(this)
    }
  }
  return { workerInstances: instances, FakeWorker: FW }
})

vi.mock('worker_threads', () => ({ Worker: FakeWorker }))

import { EmbeddingWorkerManager } from '../../../services/search/EmbeddingWorkerManager'

describe('EmbeddingWorkerManager (S11-03)', () => {
  beforeEach(() => {
    workerInstances.length = 0
  })

  async function startedManager() {
    const mgr = new EmbeddingWorkerManager({
      workerPath: '/fake/worker.js',
      modelCacheDir: '/cache',
      localModelsRoot: '/models'
    })
    const p = mgr.ensureWorker('model-x')
    workerInstances[0].emit('message', { type: 'init_done', id: null, payload: {} })
    await p
    return mgr
  }

  it('rejects in-flight embed() promises when the worker exits', async () => {
    const mgr = await startedManager()
    const embedPromise = mgr.embed('hello')
    workerInstances[0].emit('exit', 1)
    await expect(embedPromise).rejects.toThrow(/worker exited/)
  })

  it('rejects in-flight embed() promises on a worker error', async () => {
    const mgr = await startedManager()
    const embedPromise = mgr.embed('hello')
    workerInstances[0].emit('error', new Error('OOM'))
    await expect(embedPromise).rejects.toThrow(/worker error/)
  })

  it('rejects a vectorless embed_done instead of hanging', async () => {
    const mgr = await startedManager()
    const embedPromise = mgr.embed('hello')
    const embedCall = workerInstances[0].postMessage.mock.calls.find((c) => c[0]?.type === 'embed')
    workerInstances[0].emit('message', { type: 'embed_done', id: embedCall?.[0].id, payload: {} })
    await expect(embedPromise).rejects.toThrow(/no vector/)
  })
})
