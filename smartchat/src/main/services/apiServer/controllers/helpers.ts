import http from 'http'

// S11-08: cap the buffered request body and collect Buffers (not per-chunk
// UTF-8 strings) so (1) a large / slow-loris request can't OOM the Electron
// main process and (2) a multi-byte character split across TCP chunks isn't
// corrupted.
const MAX_REQUEST_BODY_BYTES = 5 * 1024 * 1024
const REQUEST_BODY_IDLE_TIMEOUT_MS = 30_000

export function readRequestBody(
  req: http.IncomingMessage,
  maxBytes: number = MAX_REQUEST_BODY_BYTES
): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    const chunks: Buffer[] = []
    let total = 0
    let settled = false

    const idleTimer = setTimeout(() => {
      finish(() => reject(new Error('Request body read timed out')))
      req.destroy()
    }, REQUEST_BODY_IDLE_TIMEOUT_MS)

    const finish = (fn: () => void): void => {
      if (settled) return
      settled = true
      clearTimeout(idleTimer)
      fn()
    }

    req.on('data', (chunk: Buffer) => {
      if (settled) return
      idleTimer.refresh()
      total += chunk.length
      if (total > maxBytes) {
        finish(() => reject(new Error('Request body too large')))
        req.destroy()
        return
      }
      chunks.push(chunk)
    })
    req.on('end', () => {
      finish(() => resolve(Buffer.concat(chunks).toString('utf-8')))
    })
    req.on('error', (err) => {
      finish(() => reject(err))
    })
  })
}

export function sendJSON(res: http.ServerResponse, statusCode: number, data: unknown): void {
  res.writeHead(statusCode, { 'Content-Type': 'application/json' })
  res.end(JSON.stringify(data))
}
