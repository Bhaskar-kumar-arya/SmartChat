import { parentPort } from 'worker_threads'

let pipeline: any = null
let env: any = null
let currentModelName = 'bhasha-embed-onnx-quantized'
let localModelsRoot = ''
let modelCacheDir = ''

parentPort?.on('message', async (msg) => {
  try {
    if (msg.type === 'init') {
      localModelsRoot = msg.payload.localModelsRoot
      modelCacheDir = msg.payload.modelCacheDir
      currentModelName = msg.payload.modelName || currentModelName

      const transformers = await import('@xenova/transformers')
      env = transformers.env
      env.cacheDir = modelCacheDir
      env.localModelPath = localModelsRoot
      env.allowLocalModels = true
      env.allowRemoteModels = true

      try {
        pipeline = await transformers.pipeline('feature-extraction', currentModelName, {
          quantized: true,
          progress_callback: (p: any) => {
            parentPort?.postMessage({ type: 'progress', payload: p })
          }
        })
        parentPort?.postMessage({ type: 'init_done' })
      } catch (err) {
        if (currentModelName !== 'bhasha-embed-onnx-quantized') {
          currentModelName = 'bhasha-embed-onnx-quantized'
          pipeline = await transformers.pipeline('feature-extraction', currentModelName, { quantized: true })
          parentPort?.postMessage({ type: 'init_done', payload: { fallback: true, modelName: currentModelName } })
        } else {
          throw err
        }
      }
    } else if (msg.type === 'setModel') {
      if (currentModelName !== msg.payload.modelName) {
        currentModelName = msg.payload.modelName
        pipeline = null // Pipeline will be initialized next time if needed, or we could initialize it here
      }
      parentPort?.postMessage({ type: 'setModel_done', payload: { modelName: currentModelName } })
    } else if (msg.type === 'embed') {
      if (!pipeline) {
        // Auto-init if pipeline is null due to setModel
        const transformers = await import('@xenova/transformers')
        pipeline = await transformers.pipeline('feature-extraction', currentModelName, {
          quantized: true,
          progress_callback: (p: any) => {
            parentPort?.postMessage({ type: 'progress', payload: p })
          }
        })
      }
      // Note: text could be an array or single string, depending. We assume string here based on service
      const output = await pipeline(msg.payload.text, { pooling: 'mean', normalize: true })
      const vector = Array.from(output.data as Float32Array)
      parentPort?.postMessage({
        type: 'embed_done',
        id: msg.id,
        payload: { vector }
      })
    }
  } catch (err: any) {
    parentPort?.postMessage({
      type: 'error',
      id: msg.id || null, // Ensure ID is passed back to reject correct promise
      payload: { error: err.message || err.toString() }
    })
  }
})
