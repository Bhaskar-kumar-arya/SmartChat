import { describe, it, expect, vi } from 'vitest'
import { useLocalPrismaAuthState } from '../../../../workers/whatsapp/socket/useLocalPrismaAuthState'

/**
 * S10-02 regression: a failed keystore transaction must NOT be swallowed.
 * Baileys advances the ratchet / advertises these keys before calling set(),
 * so dropping the write silently corrupts the session until a re-link.
 */

function makePrisma(txImpl: (ops: unknown[]) => Promise<unknown>) {
  return {
    authState: {
      findUnique: vi.fn().mockResolvedValue(null),
      upsert: vi.fn((args: unknown) => ({ __op: 'upsert', args })),
      deleteMany: vi.fn((args: unknown) => ({ __op: 'deleteMany', args }))
    },
    $transaction: vi.fn(txImpl)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any
}

const sampleData = {
  'pre-key': { '1': { public: Buffer.from('aa'), private: Buffer.from('bb') } }
} as unknown as Parameters<
  Awaited<ReturnType<typeof useLocalPrismaAuthState>>['state']['keys']['set']
>[0]

describe('useLocalPrismaAuthState keystore.set', () => {
  it('persists in a single transaction on the happy path', async () => {
    const prisma = makePrisma(() => Promise.resolve([]))
    const { state } = await useLocalPrismaAuthState(prisma)

    await state.keys.set(sampleData)

    expect(prisma.$transaction).toHaveBeenCalledTimes(1)
  })

  it('retries a transient failure and succeeds', async () => {
    let calls = 0
    const prisma = makePrisma(() => {
      calls += 1
      return calls < 3 ? Promise.reject(new Error('database is locked')) : Promise.resolve([])
    })
    const { state } = await useLocalPrismaAuthState(prisma)

    await state.keys.set(sampleData)

    expect(prisma.$transaction).toHaveBeenCalledTimes(3)
  })

  it('throws (does not swallow) when every attempt fails', async () => {
    const prisma = makePrisma(() => Promise.reject(new Error('database is locked')))
    const { state } = await useLocalPrismaAuthState(prisma)

    await expect(state.keys.set(sampleData)).rejects.toThrow(/failed after 3 attempts/)
    expect(prisma.$transaction).toHaveBeenCalledTimes(3)
  })
})
