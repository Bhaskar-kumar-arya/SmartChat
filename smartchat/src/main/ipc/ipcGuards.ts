import { basename, resolve, sep } from 'path'

/**
 * S10-04: resolve `fileName` (a renderer-supplied argument) to a path that is
 * guaranteed to sit directly inside `baseDir`. Strips any directory component
 * and rejects traversal / absolute paths so a crafted name like
 * `..\\..\\dev.db` cannot make a write escape the intended directory.
 */
export function resolveInsideDir(baseDir: string, fileName: string): string {
  if (typeof fileName !== 'string' || fileName.length === 0) {
    throw new Error('[IPC] Invalid file name')
  }
  const safeName = basename(fileName)
  if (!safeName || safeName === '.' || safeName === '..') {
    throw new Error('[IPC] Invalid file name')
  }
  const baseResolved = resolve(baseDir)
  const resolved = resolve(baseResolved, safeName)
  if (resolved !== baseResolved + sep + safeName) {
    throw new Error('[IPC] Resolved path escapes base directory')
  }
  return resolved
}

/**
 * S10-05 / S10-06: only the top-level app renderer frame may invoke privileged
 * / destructive IPC channels. A <webview> guest page (webviewTag is on), a
 * sub-frame, or an injected cross-origin document has a different frame URL and
 * is rejected — closing the "one ipcRenderer.invoke from anywhere wipes all
 * data / runs a permission-gated tool" gap.
 */
export function isTrustedSender(event: {
  senderFrame?: { parent?: unknown; url?: string } | null
}): boolean {
  try {
    const frame = event.senderFrame
    if (!frame || frame.parent) return false
    const url = frame.url || ''
    const devUrl = process.env['ELECTRON_RENDERER_URL']
    if (devUrl && url.startsWith(devUrl)) return true
    if (url.startsWith('file://') && url.endsWith('/renderer/index.html')) return true
    return false
  } catch {
    return false
  }
}
