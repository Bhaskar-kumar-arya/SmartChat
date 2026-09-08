import { describe, it, expect } from 'vitest'
import { canonicalShaHex } from '../../../services/messages/shaUtils'

describe('canonicalShaHex (P2-S2-06)', () => {
  const bytes = [1, 2, 3, 250, 255, 0, 42, 17]
  const hex = Buffer.from(bytes).toString('hex')
  const base64 = Buffer.from(bytes).toString('base64')

  it('normalises every sha shape to the same lowercase hex string', () => {
    expect(canonicalShaHex(Buffer.from(bytes))).toBe(hex)
    expect(canonicalShaHex(new Uint8Array(bytes))).toBe(hex)
    expect(canonicalShaHex(bytes)).toBe(hex)
    expect(canonicalShaHex({ type: 'Buffer', data: bytes })).toBe(hex)
    expect(canonicalShaHex(base64)).toBe(hex)
    expect(canonicalShaHex(hex)).toBe(hex)
    expect(canonicalShaHex(hex.toUpperCase())).toBe(hex)
  })

  it('a base64 string and its Buffer-object form yield an identical key', () => {
    const asObject = canonicalShaHex({ type: 'Buffer', data: bytes })
    const asBase64String = canonicalShaHex(base64)
    expect(asObject).toBe(asBase64String)
  })

  it('returns null for missing / empty / unusable input', () => {
    expect(canonicalShaHex(null)).toBeNull()
    expect(canonicalShaHex(undefined)).toBeNull()
    expect(canonicalShaHex('')).toBeNull()
    expect(canonicalShaHex('   ')).toBeNull()
    expect(canonicalShaHex(Buffer.alloc(0))).toBeNull()
    expect(canonicalShaHex([])).toBeNull()
    expect(canonicalShaHex(123 as unknown)).toBeNull()
  })
})
