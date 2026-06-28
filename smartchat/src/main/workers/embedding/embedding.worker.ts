import { parentPort } from 'worker_threads'

// let pipeline: unknown = null
// let env: unknown = null
// let currentModelName = 'Xenova/all-MiniLM-L6-v2'
// let localModelsRoot = ''
// let modelCacheDir = ''

interface WorkerMessage {
  type: string
  id?: string
  payload?: {
    modelName?: string
    localModelsRoot?: string
    modelCacheDir?: string
    text?: string
  }
}

parentPort?.on('message', async (msg: unknown) => {
  const msgObj = msg as WorkerMessage
  try {
    if (msgObj.type === 'init') {
      parentPort?.postMessage({ type: 'init_done' })
    } else if (msgObj.type === 'setModel') {
      const modelName = msgObj.payload?.modelName
      parentPort?.postMessage({ type: 'setModel_done', payload: { modelName } })
    } else if (msgObj.type === 'embed') {
      const dummyVector = new Array(768).fill(0)
      parentPort?.postMessage({
        type: 'embed_done',
        id: msgObj.id,
        payload: { vector: dummyVector }
      })
    }
  } catch (err: unknown) {
    const errVal = err as Error
    parentPort?.postMessage({
      type: 'error',
      id: msgObj.id || null,
      payload: { error: errVal?.message || String(errVal) }
    })
  }
  // try {
  //   if (msgObj.type === 'init') {
  //     localModelsRoot = msgObj.payload?.localModelsRoot || ''
  //     modelCacheDir = msgObj.payload?.modelCacheDir || ''
  //     currentModelName = msgObj.payload?.modelName || currentModelName

  //     const transformers = await import('@xenova/transformers')
  //     env = transformers.env
  //     env.cacheDir = modelCacheDir
  //     env.allowLocalModels = false
  //     env.allowRemoteModels = true

  //     try {
  //       pipeline = await transformers.pipeline('feature-extraction', currentModelName, {
  //         quantized: true,
  //         progress_callback: (p: unknown) => {
  //           parentPort?.postMessage({ type: 'progress', payload: p })
  //         }
  //       })
  //       parentPort?.postMessage({ type: 'init_done' })
  //     } catch (err) {
  //       if (currentModelName !== 'Xenova/all-MiniLM-L6-v2') {
  //         currentModelName = 'Xenova/all-MiniLM-L6-v2'
  //         pipeline = await transformers.pipeline('feature-extraction', currentModelName, { quantized: true })
  //         parentPort?.postMessage({ type: 'init_done', payload: { fallback: true, modelName: currentModelName } })
  //       } else {
  //         throw err
  //       }
  //     }
  //   } else if (msgObj.type === 'setModel') {
  //     if (currentModelName !== msgObj.payload?.modelName) {
  //       currentModelName = msgObj.payload?.modelName || ''
  //       pipeline = null // Pipeline will be initialized next time if needed, or we could initialize it here
  //     }
  //     parentPort?.postMessage({ type: 'setModel_done', payload: { modelName: currentModelName } })
  //   } else if (msgObj.type === 'embed') {
  //     if (!pipeline) {
  //       // Auto-init if pipeline is null due to setModel
  //       const transformers = await import('@xenova/transformers')
  //       pipeline = await transformers.pipeline('feature-extraction', currentModelName, {
  //         quantized: true,
  //         progress_callback: (p: unknown) => {
  //           parentPort?.postMessage({ type: 'progress', payload: p })
  //         }
  //       })
  //     }
  //     // Note: text could be an array or single string, depending. We assume string here based on service
  //     const output = await pipeline(msgObj.payload?.text, { pooling: 'mean', normalize: true })
  //     const vector = Array.from(output.data as Float32Array)
  //     parentPort?.postMessage({
  //       type: 'embed_done',
  //       id: msgObj.id,
  //       payload: { vector }
  //     })
  //   }
  // } catch (err: unknown) {
  //   const errVal = err as Error
  //   parentPort?.postMessage({
  //     type: 'error',
  //     id: msgObj.id || null, // Ensure ID is passed back to reject correct promise
  //     payload: { error: errVal?.message || String(errVal) }
  //   })
  // }
})
