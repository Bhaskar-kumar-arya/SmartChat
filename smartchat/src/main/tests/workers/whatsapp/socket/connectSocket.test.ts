import { describe, it, expect, vi, beforeEach } from 'vitest'

/**
 * Pass-2 Slice 1 regression.
 *
 * P2-S1-01: the getMessage callback in connectSocket used
 *           `JSON.parse(msg.content)` with no Buffer reviver. Baileys byte
 *           fields (mediaKey, messageSecret, …) are Uint8Arrays that serialize
 *           to numeric-keyed objects; without BufferJSON.reviver they come back
 *           as plain objects and poll-vote / retry-receipt decryption fails
 *           inside Baileys. It must parse with `BufferJSON.reviver`.
 */

const capturedOptions: { current: Record<string, any> | null } = { current: null }

vi.mock('@whiskeysockets/baileys', async (importOriginal) => {
  const mod = await importOriginal<typeof import('@whiskeysockets/baileys')>()
  return {
    ...mod,
    default: vi.fn((opts: Record<string, any>) => {
      capturedOptions.current = opts
      return { ev: {}, user: null } as any
    })
  }
})

import { connectSocket } from '../../../../workers/whatsapp/socket/connectSocket'

describe('connectSocket — P2-S1-01 getMessage BufferJSON reviver', () => {
  beforeEach(() => {
    capturedOptions.current = null
  })

  function makeSock(findUnique: any) {
    const prisma = { message: { findUnique } } as any
    connectSocket({
      version: [2, 3000, 1],
      state: {} as any,
      syncFullHistory: false,
      currentShouldSyncHistory: false,
      groupCache: { get: () => undefined } as any,
      prisma
    })
    return capturedOptions.current!
  }

  it('revives serialized byte fields into real Buffers', async () => {
    // How a Baileys Uint8Array byte field round-trips through plain JSON.stringify.
    const persisted = JSON.stringify({
      messageContextInfo: {
        messageSecret: new Uint8Array([1, 2, 3, 4])
      }
    })
    // sanity: without a reviver this is a plain numeric-keyed object
    expect(Buffer.isBuffer(JSON.parse(persisted).messageContextInfo.messageSecret)).toBe(false)

    const opts = makeSock(vi.fn().mockResolvedValue({ id: 'm1', content: persisted }))

    const result: any = await opts.getMessage({ id: 'm1' })

    const secret = result.messageContextInfo.messageSecret
    expect(Buffer.isBuffer(secret) || secret instanceof Uint8Array).toBe(true)
    expect(Array.from(secret as Uint8Array)).toEqual([1, 2, 3, 4])
  })

  it('returns undefined when the message is not found', async () => {
    const opts = makeSock(vi.fn().mockResolvedValue(null))
    await expect(opts.getMessage({ id: 'nope' })).resolves.toBeUndefined()
  })
})
