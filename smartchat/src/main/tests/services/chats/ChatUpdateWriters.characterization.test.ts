import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest'
import { PrismaClient } from '@prisma/client'
import { getPrismaClient, resetDb } from '../../helpers'
import { groupJid, makeChat, pnJid } from '../../factories'
import { ChatService } from '../../../services/chats/ChatService'
import { ChatRepository } from '../../../services/chats/ChatRepository'
import { CommunityRepository } from '../../../services/chats/CommunityRepository'
import { SyncChatsHandler, RawChat } from '../../../services/sync/SyncChatsHandler'
import { SyncRepository } from '../../../services/sync/SyncRepository'
import { ChatSyncHandler } from '../../../services/chats/sync/ChatSyncHandler'
import { CommunitySyncHandler } from '../../../services/chats/sync/CommunitySyncHandler'
import type { ChatUpdatePayload } from '../../../domain/whatsapp.types'
import type { BaileysGroupMetadata } from '../../../services/whatsapp/types/group.types'

/**
 * R-DATA-07 characterization: the three chat writers
 *   live      = ChatService.upsertChat            (chats.upsert / chats.update)
 *   history   = SyncChatsHandler.processChats      (history sync)
 *   group     = CommunitySyncHandler + ChatSyncHandler (full group hydration)
 * each map a raw payload to Chat columns slightly differently. This table pins every
 * writer's CURRENT output against a real DB so the normalizer extraction cannot silently
 * change which fields overwrite. Divergences between writers are intentional pins, not
 * endorsements (see R-DATA-07 follow-ups).
 */
type Writer = 'live' | 'history' | 'group'

interface Snap {
  name: string | null
  timestamp: number
  unreadCount: number
  pinned: number
  muteExpiration: number
  isArchived: boolean
  profilePictureUrl: string | null
  type: string
}

const SEED: Snap = {
  name: 'Old',
  timestamp: 100,
  unreadCount: 7,
  pinned: 1,
  muteExpiration: 50,
  isArchived: true,
  profilePictureUrl: 'old.png',
  type: 'GROUP'
}

interface FieldCase {
  title: string
  raw: Record<string, unknown>
  all?: Partial<Snap>
  live?: Partial<Snap>
  history?: Partial<Snap>
  group?: Partial<Snap>
}

const MS = 1_700_000_000_000
const SEC = 1_700_000_000

// Expected = SEED overlaid with `all`, then the writer-specific overlay.
const FIELD_CASES: FieldCase[] = [
  { title: 'empty payload leaves every column untouched', raw: {} },
  { title: 'name', raw: { name: 'New' }, all: { name: 'New' } },
  {
    title: 'subject only (history ignores subject)',
    raw: { subject: 'Subj' },
    all: { name: 'Subj' },
    history: { name: 'Old' }
  },
  {
    title: 'empty name + subject (history overwrites with empty string)',
    raw: { name: '', subject: 'Subj' },
    all: { name: 'Subj' },
    history: { name: '' }
  },
  {
    title: 'null name (history nulls it, others ignore)',
    raw: { name: null },
    history: { name: null }
  },
  {
    title: 'empty name + null subject (live nulls it, history empties it, group ignores)',
    raw: { name: '', subject: null },
    live: { name: null },
    history: { name: '' }
  },
  { title: 'conversationTimestamp seconds', raw: { conversationTimestamp: 2000 }, all: { timestamp: 2000 } },
  {
    title: 'timestamp 0 (only group writes 0)',
    raw: { conversationTimestamp: 0 },
    group: { timestamp: 0 }
  },
  {
    title: 'null conversationTimestamp falls back to timestamp',
    raw: { conversationTimestamp: null, timestamp: 3000 },
    all: { timestamp: 3000 }
  },
  {
    title: 'Long-like {low} only',
    raw: { conversationTimestamp: { low: 5000, high: 0 } },
    all: { timestamp: 5000 }
  },
  {
    title: 'Long-like with high word (live drops high)',
    raw: { conversationTimestamp: { low: 1, high: 1 } },
    all: { timestamp: 4294967297 },
    live: { timestamp: 1 }
  },
  { title: 'archived false', raw: { archived: false }, all: { isArchived: false } },
  {
    title: 'isArchived false alone (live ignores isArchived)',
    raw: { isArchived: false },
    all: { isArchived: false },
    live: { isArchived: true }
  },
  { title: 'archived null', raw: { archived: null }, all: { isArchived: false } },
  {
    title: 'unreadCount -1 (live ignores unknown, others persist)',
    raw: { unreadCount: -1 },
    all: { unreadCount: -1 },
    live: { unreadCount: 7 }
  },
  { title: 'unreadCount 0', raw: { unreadCount: 0 }, all: { unreadCount: 0 } },
  { title: 'pinned 0 (history ignores pinned)', raw: { pinned: 0 }, all: { pinned: 0 }, history: { pinned: 1 } },
  {
    title: 'pinned null (only live resets to 0)',
    raw: { pinned: null },
    live: { pinned: 0 }
  },
  {
    title: 'pinned true (only live coerces boolean)',
    raw: { pinned: true },
    live: { pinned: 1 }
  },
  { title: 'mute in ms normalised to seconds', raw: { muteExpiration: MS }, all: { muteExpiration: SEC } },
  { title: 'mute -1 forever', raw: { muteExpiration: -1 }, all: { muteExpiration: -1 } },
  {
    title: 'mute null (history skips, live/group zero it)',
    raw: { muteExpiration: null },
    live: { muteExpiration: 0 },
    group: { muteExpiration: 0 }
  },
  {
    title: 'muteEndTime alone (only history reads it)',
    raw: { muteEndTime: SEC },
    history: { muteExpiration: SEC }
  },
  {
    title: 'profilePictureUrl set (history ignores)',
    raw: { profilePictureUrl: 'new.png' },
    all: { profilePictureUrl: 'new.png' },
    history: { profilePictureUrl: 'old.png' }
  },
  {
    title: 'profilePictureUrl empty string (live keeps "", group nulls, history ignores)',
    raw: { profilePictureUrl: '' },
    live: { profilePictureUrl: '' },
    group: { profilePictureUrl: null }
  },
  {
    title: 'profilePictureUrl null',
    raw: { profilePictureUrl: null },
    live: { profilePictureUrl: null },
    group: { profilePictureUrl: null }
  }
]

interface CommunitySnap {
  type: string
  communityJid: string | null
  communityName: string | null
  announceJid: string | null
}

interface ClassCase {
  title: string
  jid?: () => string
  raw: (self: string, parent: string) => Record<string, unknown>
  /** expected per writer; `parent`/`self` placeholders resolved at assertion time */
  live: (self: string, parent: string) => CommunitySnap
  history: (self: string, parent: string) => CommunitySnap
  group: (self: string, parent: string) => CommunitySnap
}

const none = (type: string): CommunitySnap => ({ type, communityJid: null, communityName: null, announceJid: null })

const CLASS_CASES: ClassCase[] = [
  {
    title: 'plain group, no community fields',
    raw: () => ({}),
    live: () => none('GROUP'),
    history: () => none('GROUP'),
    group: () => none('GROUP')
  },
  {
    title: 'plain DM, no community fields',
    jid: pnJid,
    raw: () => ({}),
    live: () => none('DM'),
    history: () => none('DM'),
    group: () => none('GROUP') // group writer always inserts GROUP
  },
  {
    title: 'newsletter jid is typed DM today (no newsletter inference)',
    jid: () => 'abc123@newsletter',
    raw: () => ({}),
    live: () => none('DM'),
    history: () => none('DM'),
    group: () => none('GROUP')
  },
  {
    title: 'broadcast jid is typed DM today (no broadcast inference)',
    jid: () => 'status@broadcast',
    raw: () => ({}),
    live: () => none('DM'),
    history: () => none('DM'),
    group: () => none('GROUP')
  },
  {
    title: 'isCommunity root',
    raw: () => ({ name: 'Comm', isCommunity: true }),
    live: (s) => ({ type: 'COMMUNITY', communityJid: s, communityName: 'Comm', announceJid: null }),
    history: (s) => ({ type: 'COMMUNITY', communityJid: s, communityName: 'Comm', announceJid: null }),
    group: (s) => ({ type: 'COMMUNITY', communityJid: s, communityName: 'Comm', announceJid: null })
  },
  {
    title: 'isParentGroup root',
    raw: () => ({ name: 'Comm', isParentGroup: true }),
    live: (s) => ({ type: 'COMMUNITY', communityJid: s, communityName: 'Comm', announceJid: null }),
    history: (s) => ({ type: 'COMMUNITY', communityJid: s, communityName: 'Comm', announceJid: null }),
    group: (s) => ({ type: 'COMMUNITY', communityJid: s, communityName: 'Comm', announceJid: null })
  },
  {
    title: 'subgroup via linkedParentJid',
    raw: (_s, p) => ({ linkedParentJid: p }),
    live: (_s, p) => ({ type: 'SUBGROUP', communityJid: p, communityName: null, announceJid: null }),
    history: (_s, p) => ({ type: 'SUBGROUP', communityJid: p, communityName: null, announceJid: null }),
    group: (_s, p) => ({ type: 'SUBGROUP', communityJid: p, communityName: null, announceJid: null })
  },
  {
    title: 'isCommunityAnnounce + parent',
    raw: (_s, p) => ({ isCommunityAnnounce: true, linkedParentJid: p }),
    live: (s, p) => ({ type: 'ANNOUNCE', communityJid: p, communityName: null, announceJid: s }),
    history: (s, p) => ({ type: 'ANNOUNCE', communityJid: p, communityName: null, announceJid: s }),
    group: (s, p) => ({ type: 'ANNOUNCE', communityJid: p, communityName: null, announceJid: s })
  },
  {
    title: 'isDefaultSubgroup + parent',
    raw: (_s, p) => ({ isDefaultSubgroup: true, parentGroupId: p }),
    live: (s, p) => ({ type: 'ANNOUNCE', communityJid: p, communityName: null, announceJid: s }),
    history: (s, p) => ({ type: 'ANNOUNCE', communityJid: p, communityName: null, announceJid: s }),
    group: (s, p) => ({ type: 'ANNOUNCE', communityJid: p, communityName: null, announceJid: s })
  },
  {
    // SUSPECT DIVERGENCE: history sync does not count isAnnounce as an announce flag.
    title: 'isAnnounce alone (SUSPECT: history -> GROUP, live/group -> ANNOUNCE)',
    raw: () => ({ isAnnounce: true }),
    live: () => none('ANNOUNCE'),
    history: () => none('GROUP'),
    group: () => none('ANNOUNCE')
  },
  {
    title: 'isAnnounce + parent (SUSPECT: history -> SUBGROUP without announceJid)',
    raw: (_s, p) => ({ isAnnounce: true, linkedParentJid: p }),
    live: (s, p) => ({ type: 'ANNOUNCE', communityJid: p, communityName: null, announceJid: s }),
    history: (_s, p) => ({ type: 'SUBGROUP', communityJid: p, communityName: null, announceJid: null }),
    group: (s, p) => ({ type: 'ANNOUNCE', communityJid: p, communityName: null, announceJid: s })
  },
  {
    title: 'isAnnounce false still counts as community data -> GROUP',
    raw: () => ({ isAnnounce: false }),
    live: () => none('GROUP'),
    history: () => none('GROUP'),
    group: () => none('GROUP')
  },
  {
    title: 'isAnnounce false on a DM jid is typed DM',
    jid: pnJid,
    raw: () => ({ isAnnounce: false }),
    live: () => none('DM'),
    history: () => none('DM'),
    group: () => none('DM') // community data present, so group classifies by jid too
  }
]

describe('chat update writers (real DB characterization)', () => {
  let prisma: PrismaClient
  let chatRepo: ChatRepository
  let communityRepo: CommunityRepository
  let syncRepo: SyncRepository
  let chatService: ChatService
  let historyHandler: SyncChatsHandler

  beforeAll(() => {
    prisma = getPrismaClient()
  })
  afterAll(async () => {
    await prisma.$disconnect()
  })
  beforeEach(async () => {
    await resetDb(prisma)
    chatRepo = new ChatRepository(prisma)
    communityRepo = new CommunityRepository(prisma)
    syncRepo = new SyncRepository(prisma)
    chatService = new ChatService(
      chatRepo,
      communityRepo,
      { batchResolveNames: vi.fn() } as never,
      { linkGroupMetadataOwners: vi.fn().mockResolvedValue(undefined) } as never,
      {} as never,
      () => null
    )
    historyHandler = new SyncChatsHandler(chatRepo, communityRepo, { linkLidAndPn: vi.fn() } as never)
    vi.spyOn(console, 'log').mockImplementation(() => undefined)
  })

  async function write(writer: Writer, jid: string, raw: Record<string, unknown>): Promise<void> {
    if (writer === 'live') {
      await chatService.upsertChat(jid, raw as unknown as ChatUpdatePayload)
    } else if (writer === 'history') {
      await historyHandler.processChats([{ id: jid, ...raw } as unknown as RawChat], new Set())
    } else {
      const groups = { [jid]: { id: jid, ...raw } } as unknown as Record<string, BaileysGroupMetadata>
      const map = await new CommunitySyncHandler(syncRepo).syncCommunities(groups)
      await new ChatSyncHandler(syncRepo).syncChats(groups, map)
    }
  }

  async function snap(jid: string): Promise<Snap> {
    const c = await prisma.chat.findUniqueOrThrow({ where: { jid } })
    return {
      name: c.name,
      timestamp: Number(c.timestamp),
      unreadCount: c.unreadCount,
      pinned: c.pinned,
      muteExpiration: Number(c.muteExpiration),
      isArchived: c.isArchived,
      profilePictureUrl: c.profilePictureUrl,
      type: c.type
    }
  }

  async function communitySnap(jid: string): Promise<CommunitySnap> {
    const c = await prisma.chat.findUniqueOrThrow({ where: { jid }, include: { community: true } })
    return {
      type: c.type,
      communityJid: c.community?.jid ?? null,
      communityName: c.community?.name ?? null,
      announceJid: c.community?.announceJid ?? null
    }
  }

  const WRITERS: Writer[] = ['live', 'history', 'group']

  describe('field mapping on an existing chat', () => {
    for (const writer of WRITERS) {
      describe(writer, () => {
        for (const c of FIELD_CASES) {
          it(c.title, async () => {
            const jid = groupJid()
            await makeChat(prisma, {
              jid,
              type: SEED.type,
              name: SEED.name,
              timestamp: BigInt(SEED.timestamp),
              unreadCount: SEED.unreadCount,
              pinned: SEED.pinned,
              muteExpiration: BigInt(SEED.muteExpiration),
              isArchived: SEED.isArchived,
              profilePictureUrl: SEED.profilePictureUrl
            })
            await write(writer, jid, c.raw)
            expect(await snap(jid)).toEqual({ ...SEED, ...c.all, ...c[writer] })
          })
        }
      })
    }
  })

  describe('insert of a brand-new chat', () => {
    const FULL = {
      name: 'N',
      unreadCount: 3,
      pinned: 2,
      conversationTimestamp: 500,
      archived: true,
      muteExpiration: SEC,
      profilePictureUrl: 'p.png'
    }
    const DEFAULTS: Snap = {
      name: null,
      timestamp: 0,
      unreadCount: 0,
      pinned: 0,
      muteExpiration: 0,
      isArchived: false,
      profilePictureUrl: null,
      type: 'GROUP'
    }
    const FULL_SNAP: Snap = {
      name: 'N',
      timestamp: 500,
      unreadCount: 3,
      pinned: 2,
      muteExpiration: SEC,
      isArchived: true,
      profilePictureUrl: 'p.png',
      type: 'GROUP'
    }

    for (const writer of WRITERS) {
      it(`${writer}: empty payload creates default row`, async () => {
        const jid = groupJid()
        await write(writer, jid, {})
        expect(await snap(jid)).toEqual(DEFAULTS)
      })
      it(`${writer}: full payload`, async () => {
        const jid = groupJid()
        await write(writer, jid, FULL)
        const expected: Snap = { ...FULL_SNAP }
        // history sync does not read pinned or profilePictureUrl
        if (writer === 'history') {
          expected.pinned = 0
          expected.profilePictureUrl = null
        }
        expect(await snap(jid)).toEqual(expected)
      })
    }
  })

  describe('classification and community linking (fresh row)', () => {
    for (const writer of WRITERS) {
      describe(writer, () => {
        for (const c of CLASS_CASES) {
          it(c.title, async () => {
            const jid = (c.jid ?? groupJid)()
            const parent = groupJid()
            await write(writer, jid, c.raw(jid, parent))
            expect(await communitySnap(jid)).toEqual(c[writer](jid, parent))
          })
        }
      })
    }
  })

  describe('community link on an existing chat', () => {
    async function seedLinked(): Promise<{ jid: string; communityId: number }> {
      const comm = await prisma.community.create({ data: { jid: groupJid(), name: 'Seeded' } })
      const jid = groupJid()
      await makeChat(prisma, { jid, type: 'SUBGROUP', communityId: comm.id })
      return { jid, communityId: comm.id }
    }

    it('live: community fields without a parent reset communityId to null and retype', async () => {
      const { jid } = await seedLinked()
      await write('live', jid, { isAnnounce: false })
      expect((await prisma.chat.findUniqueOrThrow({ where: { jid } })).communityId).toBeNull()
      expect((await snap(jid)).type).toBe('GROUP')
    })

    it('history: community fields without a parent reset communityId to null and retype', async () => {
      const { jid } = await seedLinked()
      await write('history', jid, { isAnnounce: false })
      expect((await prisma.chat.findUniqueOrThrow({ where: { jid } })).communityId).toBeNull()
      expect((await snap(jid)).type).toBe('GROUP')
    })

    it('group: community fields without a parent keep the existing communityId but retype', async () => {
      const { jid, communityId } = await seedLinked()
      await write('group', jid, { isAnnounce: false })
      expect((await prisma.chat.findUniqueOrThrow({ where: { jid } })).communityId).toBe(communityId)
      expect((await snap(jid)).type).toBe('GROUP')
    })

    it('no writer touches type or communityId when the payload has no community fields', async () => {
      for (const writer of WRITERS) {
        const { jid, communityId } = await seedLinked()
        await write(writer, jid, { name: 'X' })
        const row = await prisma.chat.findUniqueOrThrow({ where: { jid } })
        expect(row.communityId).toBe(communityId)
        expect(row.type).toBe('SUBGROUP')
      }
    })
  })
})
