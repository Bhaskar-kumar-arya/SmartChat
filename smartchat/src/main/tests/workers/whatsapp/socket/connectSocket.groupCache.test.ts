import { describe, it, expect, vi, beforeEach } from 'vitest'
import { EventEmitter } from 'events'
import NodeCache from 'node-cache'
import type { AuthenticationState } from '@whiskeysockets/baileys'
import type { PrismaClient } from '@prisma/client'

/**
 * B-WA-08: `cachedGroupMetadata` never hit because nothing ever filled the cache,
 * so Baileys sent a `groupMetadata` IQ on every group send/retry. The cache must
 * be filled from groupFetchAllParticipating and kept fresh from group events.
 */

type Opts = { cachedGroupMetadata: (jid: string) => Promise<unknown> }
const capturedOptions: { current: Opts | null } = { current: null }
interface FakeSock { ev: EventEmitter; user: null; groupFetchAllParticipating: () => Promise<Record<string, unknown>> }
const fakeSock: { current: FakeSock | null } = { current: null }

vi.mock('@whiskeysockets/baileys', async (importOriginal) => {
  const mod = await importOriginal<typeof import('@whiskeysockets/baileys')>()
  return {
    ...mod,
    default: vi.fn((opts: Opts) => {
      capturedOptions.current = opts
      return fakeSock.current
    })
  }
})

import { connectSocket } from '../../../../workers/whatsapp/socket/connectSocket'

const GROUP = '123@g.us'
const meta = {
  id: GROUP,
  subject: 'Team',
  participants: [{ id: 'a@s.whatsapp.net' }, { id: 'b@s.whatsapp.net' }]
}

describe('connectSocket — B-WA-08 cachedGroupMetadata fill', () => {
  beforeEach(() => {
    capturedOptions.current = null
    fakeSock.current = {
      ev: new EventEmitter(),
      user: null,
      groupFetchAllParticipating: vi.fn(async () => ({ [GROUP]: meta }))
    }
  })

  function open(): Opts {
    connectSocket({
      version: [2, 3000, 1],
      state: {} as unknown as AuthenticationState,
      syncFullHistory: false,
      currentShouldSyncHistory: false,
      groupCache: new NodeCache({ stdTTL: 300, useClones: false }),
      prisma: {} as unknown as PrismaClient
    })
    return capturedOptions.current!
  }

  it.fails('serves group metadata from the cache after groupFetchAllParticipating', async () => {
    const opts = open()
    await fakeSock.current?.groupFetchAllParticipating()
    await expect(opts.cachedGroupMetadata(GROUP)).resolves.toEqual(meta)
  })
})
