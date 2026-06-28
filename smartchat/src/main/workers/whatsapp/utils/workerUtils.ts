export type MediaType = 'image' | 'sticker' | 'video' | 'document' | 'audio'

export interface HydratedTemplate {
  imageMessage?: unknown
  stickerMessage?: unknown
  videoMessage?: unknown
  documentMessage?: unknown
  audioMessage?: unknown
}

export interface InteractiveTemplate {
  header?: {
    imageMessage?: unknown
    videoMessage?: unknown
    documentMessage?: unknown
  }
}

export function resolveMediaType(
  unwrapped: Record<string, unknown>
): { mediaType: MediaType; mediaMsg: Record<string, unknown> } | null {
  let target = unwrapped

  if (unwrapped.templateMessage) {
    const tmpl = unwrapped.templateMessage as Record<string, unknown>
    const hydrated = (tmpl.hydratedFourRowTemplate || tmpl.hydratedTemplate) as HydratedTemplate | undefined
    const interactive = tmpl.interactiveMessageTemplate as InteractiveTemplate | undefined
    target = {
      imageMessage: hydrated?.imageMessage || interactive?.header?.imageMessage,
      stickerMessage: hydrated?.stickerMessage,
      videoMessage: hydrated?.videoMessage || interactive?.header?.videoMessage,
      documentMessage: hydrated?.documentMessage || interactive?.header?.documentMessage,
      audioMessage: hydrated?.audioMessage
    }
  }

  if (target.imageMessage) return { mediaType: 'image', mediaMsg: target.imageMessage as Record<string, unknown> }
  if (target.stickerMessage) return { mediaType: 'sticker', mediaMsg: target.stickerMessage as Record<string, unknown> }
  if (target.videoMessage) return { mediaType: 'video', mediaMsg: target.videoMessage as Record<string, unknown> }
  if (target.ptvMessage) return { mediaType: 'video', mediaMsg: target.ptvMessage as Record<string, unknown> }
  if (target.audioMessage) return { mediaType: 'audio', mediaMsg: target.audioMessage as Record<string, unknown> }
  if (target.documentMessage) {
    const doc = target.documentMessage as Record<string, unknown>
    const mimetype = doc.mimetype
    const effectiveType: MediaType =
      typeof mimetype === 'string' && mimetype.startsWith('audio/')
        ? 'audio'
        : 'document'
    return { mediaType: effectiveType, mediaMsg: doc }
  }
  return null
}

export async function streamToBuffer(stream: AsyncIterable<Buffer>): Promise<Buffer> {
  const chunks: Buffer[] = []
  for await (const chunk of stream) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))
  }
  return Buffer.concat(chunks)
}

export function ensureBuffer(val: unknown): Buffer | null {
  if (!val) return null
  if (Buffer.isBuffer(val)) return val
  if (val instanceof Uint8Array) return Buffer.from(val.buffer, val.byteOffset, val.byteLength)
  if (typeof val === 'string') {
    if (/^[0-9a-fA-F]+$/.test(val) && val.length % 2 === 0) {
      return Buffer.from(val, 'hex')
    }
    return Buffer.from(val, 'base64')
  }
  if (typeof val === 'object') {
    const obj = val as Record<string, unknown>
    if (obj.type === 'Buffer' && Array.isArray(obj.data)) {
      return Buffer.from(obj.data as number[])
    }
    if (Array.isArray(val)) {
      return Buffer.from(val)
    }
  }
  return null
}

export function extractStickerSha(mediaMsg: unknown): string | null {
  if (!mediaMsg || typeof mediaMsg !== 'object') return null
  const mediaObj = mediaMsg as Record<string, unknown>
  if (!mediaObj.fileSha256) return null
  const sha = mediaObj.fileSha256
  if (typeof sha === 'string') {
    return sha
  }
  if (Buffer.isBuffer(sha)) {
    return sha.toString('base64')
  }
  if (
    sha &&
    typeof sha === 'object' &&
    'type' in sha &&
    sha.type === 'Buffer' &&
    'data' in sha &&
    Array.isArray((sha as { data: unknown }).data)
  ) {
    return Buffer.from((sha as { data: number[] }).data).toString('base64')
  }
  if (sha instanceof Uint8Array || Array.isArray(sha)) {
    return Buffer.from(sha as Uint8Array).toString('base64')
  }
  return null
}

export function restoreBuffers(obj: unknown): unknown {
  if (!obj || typeof obj !== 'object') {
    return obj
  }
  
  if (obj instanceof Uint8Array) {
    return Buffer.from(obj.buffer, obj.byteOffset, obj.byteLength)
  }

  if (Array.isArray(obj)) {
    return obj.map((item: unknown) => restoreBuffers(item))
  }

  const restored: Record<string, unknown> = {}
  const record = obj as Record<string, unknown>
  for (const [key, value] of Object.entries(record)) {
    restored[key] = restoreBuffers(value)
  }
  return restored
}

export function sanitizeForPostMessage(val: unknown, seen = new WeakSet<object>()): unknown {
  if (val === null || val === undefined) return val

  const t = typeof val
  if (t === 'function' || t === 'symbol') {
    return undefined
  }

  if (t === 'bigint') {
    return Number(val)
  }

  if (t !== 'object') {
    return val
  }

  if (val instanceof Date) {
    return new Date(val.getTime())
  }
  if (val instanceof RegExp) {
    return new RegExp(val)
  }
  if (val instanceof Uint8Array || Buffer.isBuffer(val)) {
    return val
  }

  const objVal = val as object
  if (seen.has(objVal)) {
    return undefined
  }
  seen.add(objVal)

  if (Array.isArray(val)) {
    const arr: unknown[] = []
    for (const item of val) {
      const sanitized = sanitizeForPostMessage(item, seen)
      if (sanitized !== undefined) {
        arr.push(sanitized)
      } else {
        arr.push(null)
      }
    }
    seen.delete(objVal)
    return arr
  }

  const cleaned: Record<string, unknown> = {}
  const record = val as Record<string, unknown>
  for (const [key, value] of Object.entries(record)) {
    const sanitized = sanitizeForPostMessage(value, seen)
    if (sanitized !== undefined) {
      cleaned[key] = sanitized
    }
  }
  seen.delete(objVal)
  return cleaned
}
