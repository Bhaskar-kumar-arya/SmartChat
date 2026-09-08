import { describe, it, expect, vi } from 'vitest'
import { CallRepository } from '../../../services/calls/CallRepository'
import type { CallLogEntry } from '../../../services/calls/ICallService'

function makePrisma(existing: { status: string; timestamp: bigint } | null) {
  const create = vi.fn().mockResolvedValue(undefined)
  const update = vi.fn().mockResolvedValue(undefined)
  const findUnique = vi.fn().mockResolvedValue(existing)
  return {
    prisma: { callLog: { findUnique, create, update } } as never,
    create,
    update,
    findUnique
  }
}

const base: CallLogEntry = {
  id: 'call_1',
  callerJid: 'a@s.whatsapp.net',
  isVideo: false,
  isGroup: false,
  status: 'offer',
  timestamp: 100n
}

describe('CallRepository.upsertCallLog (S11-05)', () => {
  it('creates a row when none exists', async () => {
    const m = makePrisma(null)
    await new CallRepository(m.prisma).upsertCallLog(base)
    expect(m.create).toHaveBeenCalledTimes(1)
    expect(m.update).not.toHaveBeenCalled()
  })

  it('ignores a stale (older-timestamp) re-delivered event', async () => {
    const m = makePrisma({ status: 'accept', timestamp: 200n })
    await new CallRepository(m.prisma).upsertCallLog({ ...base, status: 'offer', timestamp: 150n })
    expect(m.update).not.toHaveBeenCalled()
  })

  it('does not regress a terminal call back to a non-terminal status', async () => {
    const m = makePrisma({ status: 'reject', timestamp: 100n })
    await new CallRepository(m.prisma).upsertCallLog({ ...base, status: 'ringing', timestamp: 300n })
    expect(m.update).not.toHaveBeenCalled()
  })

  it('applies a forward transition', async () => {
    const m = makePrisma({ status: 'offer', timestamp: 100n })
    await new CallRepository(m.prisma).upsertCallLog({ ...base, status: 'accept', timestamp: 120n })
    expect(m.update).toHaveBeenCalledTimes(1)
  })

  it('P2-S3-03: keeps the first-seen (start) timestamp on a later status update', async () => {
    const m = makePrisma({ status: 'offer', timestamp: 100n })
    await new CallRepository(m.prisma).upsertCallLog({ ...base, status: 'terminate', timestamp: 500n })
    expect(m.update).toHaveBeenCalledTimes(1)
    expect(m.update.mock.calls[0][0].data.timestamp).toBe(100n)
    expect(m.update.mock.calls[0][0].data.status).toBe('terminate')
  })

  it('P2-S11-04: rethrows a non-P2002 create failure instead of recursing forever', async () => {
    const m = makePrisma(null)
    m.create.mockRejectedValue(Object.assign(new Error('db is locked'), { code: 'P2010' }))
    await expect(new CallRepository(m.prisma).upsertCallLog(base)).rejects.toThrow('db is locked')
    // one initial + no infinite retry
    expect(m.create).toHaveBeenCalledTimes(1)
  })

  it('P2-S11-04: retries a P2002 race a bounded number of times', async () => {
    const m = makePrisma(null)
    m.create.mockRejectedValue(Object.assign(new Error('unique'), { code: 'P2002' }))
    await expect(new CallRepository(m.prisma).upsertCallLog(base)).rejects.toThrow('unique')
    // initial + 2 bounded retries = 3
    expect(m.create).toHaveBeenCalledTimes(3)
  })
})
