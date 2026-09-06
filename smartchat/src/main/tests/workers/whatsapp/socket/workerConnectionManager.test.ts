import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { WorkerConnectionManager } from '../../../../workers/whatsapp/socket/workerConnectionManager'

/**
 * Batch D — Slice 1 regressions.
 *
 * S1-01: reconnect paths invoked connect() as a floating promise. A rejection
 *        (transient Prisma error during a reconnect) killed the reconnect chain
 *        silently — worker stayed offline until app restart.
 * S1-02: wipeAllData ran per-table DELETEs with no transaction and skipped
 *        `PRAGMA foreign_keys = ON` on any error, leaving FK enforcement off
 *        for the rest of the connection's life and the DB half-wiped.
 */

function makeManager(): WorkerConnectionManager {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return new WorkerConnectionManager({ publish: vi.fn() } as any)
}

describe('WorkerConnectionManager — S1-01 reconnect error handling', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  it('reschedules another reconnect when a reconnect attempt rejects', async () => {
    const manager = makeManager()
    const connect = vi
      .spyOn(manager, 'connect')
      .mockRejectedValueOnce(new Error('transient DB lock'))
      .mockResolvedValueOnce(undefined)

    // scheduleReconnect is private — exercised via the reconnect callback path.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ;(manager as any).scheduleReconnect(1000)

    await vi.advanceTimersByTimeAsync(1000)
    expect(connect).toHaveBeenCalledTimes(1)

    // First attempt rejected -> a second attempt must have been scheduled.
    await vi.advanceTimersByTimeAsync(2000)
    expect(connect).toHaveBeenCalledTimes(2)
  })

  it('caps the exponential backoff at the max delay', async () => {
    const manager = makeManager()
    const connect = vi.spyOn(manager, 'connect').mockRejectedValue(new Error('still down'))

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ;(manager as any).scheduleReconnect(40_000)
    await vi.advanceTimersByTimeAsync(40_000)
    expect(connect).toHaveBeenCalledTimes(1)

    // next delay is min(40000*2, 60000) = 60000
    await vi.advanceTimersByTimeAsync(59_999)
    expect(connect).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(1)
    expect(connect).toHaveBeenCalledTimes(2)
  })
})

describe('WorkerConnectionManager — S1-02 wipeAllData atomicity', () => {
  function makePrisma(txImpl: (ops: unknown[]) => Promise<unknown>) {
    const execCalls: string[] = []
    const prisma = {
      $queryRawUnsafe: vi.fn().mockResolvedValue([{ name: 'Chat' }, { name: 'Message' }]),
      $executeRawUnsafe: vi.fn((sql: string) => {
        execCalls.push(sql)
        return Promise.resolve(0)
      }),
      $transaction: vi.fn(txImpl)
    }
    return { prisma, execCalls }
  }

  it('wipes every table inside a single $transaction', async () => {
    const manager = makeManager()
    const { prisma } = makePrisma((_ops: unknown[]) => Promise.resolve([]))

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (manager as any).wipeAllData(prisma, 'C:/tmp/does-not-exist-userdata')

    expect(prisma.$transaction).toHaveBeenCalledTimes(1)
    const ops = prisma.$transaction.mock.calls[0][0]
    expect(Array.isArray(ops)).toBe(true)
    expect(ops).toHaveLength(2) // one DELETE per table, atomic
  })

  it('restores PRAGMA foreign_keys = ON even when the wipe transaction fails', async () => {
    const manager = makeManager()
    const { prisma, execCalls } = makePrisma((_ops: unknown[]) =>
      Promise.reject(new Error('disk I/O error'))
    )

    await expect(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (manager as any).wipeAllData(prisma, 'C:/tmp/does-not-exist-userdata')
    ).rejects.toThrow('disk I/O error')

    expect(execCalls).toContain('PRAGMA foreign_keys = OFF;')
    expect(execCalls).toContain('PRAGMA foreign_keys = ON;')
  })
})
