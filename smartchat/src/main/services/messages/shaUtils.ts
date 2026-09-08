/**
 * Canonical SHA-256 encoding helper. (P2-S2-06)
 *
 * `fileSha256` reaches us in many shapes depending on how the message `content`
 * was serialised/revived: a Node `Buffer`, a `{ type: 'Buffer', data: [...] }`
 * plain object, a `Uint8Array`, a raw number array, or a string that is itself
 * either hex or base64. Historically each call site re-derived the hash in a
 * different encoding (hex here, base64 there, "string as-is" elsewhere), so the
 * same sticker could map to two different cache filenames / DB keys.
 *
 * `canonicalShaHex` normalises every shape to one canonical form: lowercase hex.
 * Use it everywhere a sha is turned into a filename, a DB key, or a lookup key.
 */
export function canonicalShaHex(sha: unknown): string | null {
  if (sha === null || sha === undefined) return null

  if (Buffer.isBuffer(sha)) {
    return sha.length > 0 ? sha.toString('hex') : null
  }

  if (sha instanceof Uint8Array) {
    return sha.length > 0 ? Buffer.from(sha).toString('hex') : null
  }

  if (typeof sha === 'string') {
    const trimmed = sha.trim()
    if (!trimmed) return null
    // Already hex?
    if (/^[0-9a-fA-F]+$/.test(trimmed) && trimmed.length % 2 === 0) {
      return trimmed.toLowerCase()
    }
    // Otherwise treat as base64 (WhatsApp's protobuf-JSON default for bytes).
    try {
      const buf = Buffer.from(trimmed, 'base64')
      if (buf.length > 0) return buf.toString('hex')
    } catch {
      // fall through
    }
    return null
  }

  if (Array.isArray(sha)) {
    return sha.length > 0 ? Buffer.from(sha as number[]).toString('hex') : null
  }

  if (typeof sha === 'object') {
    const obj = sha as Record<string, unknown>
    if (obj.type === 'Buffer' && Array.isArray(obj.data)) {
      const data = obj.data as number[]
      return data.length > 0 ? Buffer.from(data).toString('hex') : null
    }
  }

  return null
}
