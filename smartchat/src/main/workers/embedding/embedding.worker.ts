import { parentPort } from 'worker_threads'

/**
 * Feature-extraction embedding worker.
 *
 * P2-S11-01: this used to be a stub that replied to every `embed` with a
 * 768-dim zero vector and treated `init` as a no-op. That silently broke
 * semantic ("deep") search and filled `MessageVector` / `vec_messages` with
 * thousands of identical zero rows. The real `@xenova/transformers` pipeline is
 * restored below and the worker now:
 *   - only replies `init_done` once the model pipeline has actually loaded;
 *   - replies with a global `error` message (id: null) if the model fails to
 *     load, so `EmbeddingWorkerManager.ensureWorker()` rejects and callers
 *     (`SearchService.deepSearch`, `EmbeddingService.indexAll`) degrade visibly
 *     instead of persisting garbage vectors;
 *   - rejects any `embed` received before the model is ready.
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type FeatureExtractionPipeline = (
  text: string,
  opts: { pooling: 'mean'; normalize: boolean }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
) => Promise<{ data: Float32Array | number[] }>

let pipeline: FeatureExtractionPipeline | null = null
let initPromise: Promise<void> | null = null
let currentModelName = 'Xenova/all-MiniLM-L6-v2'
let localModelsRoot = ''
let modelCacheDir = ''

interface WorkerMessage {
  type: string
  id?: number | string
  payload?: {
    modelName?: string
    localModelsRoot?: string
    modelCacheDir?: string
    text?: string
  }
}

async function loadPipeline(modelName: string): Promise<void> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const transformers: any = await import('@xenova/transformers')
  const env = transformers.env
  if (modelCacheDir) env.cacheDir = modelCacheDir
  if (localModelsRoot) env.localModelPath = localModelsRoot
  env.allowLocalModels = true
  env.allowRemoteModels = true

  try {
    pipeline = (await transformers.pipeline('feature-extraction', modelName, {
      quantized: true,
      progress_callback: (p: unknown) => {
        parentPort?.postMessage({ type: 'progress', payload: p })
      }
    })) as FeatureExtractionPipeline
    currentModelName = modelName
    parentPort?.postMessage({ type: 'init_done' })
  } catch (err) {
    if (modelName !== 'Xenova/all-MiniLM-L6-v2') {
      pipeline = (await transformers.pipeline(
        'feature-extraction',
        'Xenova/all-MiniLM-L6-v2',
        { quantized: true }
      )) as FeatureExtractionPipeline
      currentModelName = 'Xenova/all-MiniLM-L6-v2'
      parentPort?.postMessage({
        type: 'init_done',
        payload: { fallback: true, modelName: currentModelName }
      })
    } else {
      throw err
    }
  }
}

function ensurePipeline(): Promise<void> {
  if (pipeline) return Promise.resolve()
  if (!initPromise) initPromise = loadPipeline(currentModelName)
  return initPromise
}

parentPort?.on('message', async (msg: unknown) => {
  const msgObj = msg as WorkerMessage
  try {
    if (msgObj.type === 'init') {
      localModelsRoot = msgObj.payload?.localModelsRoot || ''
      modelCacheDir = msgObj.payload?.modelCacheDir || ''
      currentModelName = msgObj.payload?.modelName || currentModelName
      initPromise = loadPipeline(currentModelName)
      await initPromise
    } else if (msgObj.type === 'setModel') {
      const modelName = msgObj.payload?.modelName
      if (modelName && modelName !== currentModelName) {
        currentModelName = modelName
        pipeline = null
        initPromise = null
      }
      parentPort?.postMessage({ type: 'setModel_done', payload: { modelName: currentModelName } })
    } else if (msgObj.type === 'embed') {
      await ensurePipeline()
      if (!pipeline) throw new Error('Embedding model is not ready')
      const output = await pipeline(msgObj.payload?.text || '', { pooling: 'mean', normalize: true })
      const vector = Array.from(output.data as Float32Array)
      parentPort?.postMessage({
        type: 'embed_done',
        id: msgObj.id,
        payload: { vector }
      })
    }
  } catch (err: unknown) {
    const errVal = err as Error
    // Reset init state so a later request can retry a fresh load.
    if (msgObj.type === 'init') initPromise = null
    parentPort?.postMessage({
      type: 'error',
      id: msgObj.id ?? null,
      payload: { error: errVal?.message || String(errVal) }
    })
  }
})
