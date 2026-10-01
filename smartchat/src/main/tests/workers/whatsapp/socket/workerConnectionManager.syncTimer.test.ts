import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('../../../../workers/whatsapp/socket/connectSocket', () => ({ connectSocket: vi.fn() }))
vi.mock('../../../../workers/whatsapp/socket/useLocalPrismaAuthState', () => ({
  useLocalPrismaAuthState: vi.fn().mockResolvedValue({ state: {}, saveCreds: vi.fn() })
}))
vi.mock('@whiskeysockets/baileys', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>()
  return { ...actual, fetchLatestBaileysVersion: vi.fn().mockRejectedValue(new Error('offline')) }
})

import { WorkerConnectionManager } from '../../../../workers/whatsapp/socket/workerConnectionManager'
import { connectSocket } from '../../../../workers/whatsapp/socket/connectSocket'

/**
 * B-WA-11: a sync interrupted by a restart never completed on its own. The
 * inactivity timer was armed only inside handleSyncChunk, so if WhatsApp did not
 * resend chunks nothing called finishSync until the user pressed Skip.
 */
describe('WorkerConnectionManager — B-WA-11 inactivity timer on open', () => {
  type Handler = (u: unknown) => void
  let handlers: Record<string, Handler[]>
  let historySyncManager: { clear: ReturnType<typeof vi.fn>; isInProgress: boolean; armInactivityTimer: ReturnType<typeof vi.fn> }

  async function connectWith(opts: { hasCreds: boolean; historySyncCompleted: boolean; syncFullHistory?: boolean }) {
    handlers = {}
    const sock = {
      ev: {
        on: vi.fn((name: string, fn: Handler) => { (handlers[name] ??= []).push(fn) }),
        process: vi.fn()
      },
      end: vi.fn()
    }
    vi.mocked(connectSocket).mockReturnValue(sock as never)
    historySyncManager = { clear: vi.fn(), isInProgress: false, armInactivityTimer: vi.fn() }
    const repos = {
      historySyncManager,
      authSettingsService: {
        hasCreds: vi.fn().mockResolvedValue(opts.hasCreds),
        clearHistorySyncCompleted: vi.fn().mockResolvedValue(undefined),
        getHistorySyncCompleted: vi.fn().mockResolvedValue(opts.historySyncCompleted)
      }
    }
    const prisma = { chat: { count: vi.fn().mockResolvedValue(0) } }
    const manager = new WorkerConnectionManager({ publish: vi.fn() } as never)
    manager.setup('/tmp/none', opts.syncFullHistory ?? false, prisma as never, repos as never)
    await manager.connect()
    return { sock }
  }

  const emitOpen = (): void => {
    for (const fn of handlers['connection.update'] ?? []) fn({ connection: 'open' })
  }

  beforeEach(() => vi.clearAllMocks())

  it('arms the inactivity timer when the socket opens and history sync is incomplete', async () => {
    const { sock } = await connectWith({ hasCreds: true, historySyncCompleted: false, syncFullHistory: true })
    expect(historySyncManager.armInactivityTimer).not.toHaveBeenCalled()
    emitOpen()
    expect(historySyncManager.armInactivityTimer).toHaveBeenCalledWith(sock, true)
  })

  it('does not arm it when history sync already completed', async () => {
    await connectWith({ hasCreds: true, historySyncCompleted: true })
    emitOpen()
    expect(historySyncManager.armInactivityTimer).not.toHaveBeenCalled()
  })

  it('does not arm it on a fresh login (chunks are guaranteed to follow the pairing)', async () => {
    await connectWith({ hasCreds: false, historySyncCompleted: false })
    emitOpen()
    expect(historySyncManager.armInactivityTimer).not.toHaveBeenCalled()
  })
})
