import { describe, it, expect, vi } from 'vitest'
import { Readable } from 'stream'
import type http from 'http'
import { readRequestBody } from '../../../services/apiServer/controllers/helpers'

function fakeReq(chunks: Buffer[]): http.IncomingMessage {
  const r = Readable.from(chunks) as unknown as http.IncomingMessage & { destroy: () => void }
  r.destroy = vi.fn()
  return r
}

describe('readRequestBody (S11-08)', () => {
  it('reassembles a multi-byte character split across chunks', async () => {
    const emoji = Buffer.from('😀', 'utf-8') // 4 bytes
    const body = await readRequestBody(fakeReq([emoji.subarray(0, 2), emoji.subarray(2)]))
    expect(body).toBe('😀')
  })

  it('rejects a body over the size cap', async () => {
    const big = Buffer.alloc(2048, 0x61)
    await expect(readRequestBody(fakeReq([big, big]), 3000)).rejects.toThrow(/too large/)
  })
})
