import { vi } from 'vitest'
import { PrismaClient } from '@prisma/client'
import { PrismaBetterSqlite3 } from '@prisma/adapter-better-sqlite3'
import { join } from 'path'
import { createServices, ServiceContainer } from '../ServiceContainer'
import type { IWAEventBus } from '../services/whatsapp/IWAEventBus'
import { WAEventHandler } from '../services/whatsapp/WAEventHandler'
import { createSubscribers } from '../services/whatsapp/subscribers'

// ── Constants ────────────────────────────────────────────────────────────────

export const dbPath = join(__dirname, '../../../prisma/test.db')
export const databaseUrl = `file:${dbPath}`

// ── Database Helpers ─────────────────────────────────────────────────────────

export function getPrismaClient(): PrismaClient {
  const adapter = new PrismaBetterSqlite3({ url: databaseUrl })
  return new PrismaClient({ adapter })
}

/**
 * Clears all data-holding tables in dependency order (children before parents).
 * Keeps the schema intact — only rows are removed.
 */
export async function clearDatabase(prisma: PrismaClient): Promise<void> {
  await prisma.reaction.deleteMany({})
  await prisma.messageReceipt.deleteMany({})
  await prisma.message.deleteMany({})
  await prisma.chatMember.deleteMany({})
  await prisma.chat.deleteMany({})
  await prisma.identityAlias.deleteMany({})
  await prisma.identity.deleteMany({})
  await prisma.lidMap.deleteMany({})
}

// ── Socket Factory ───────────────────────────────────────────────────────────

interface MockSocketOptions {
  /** Override the JID of the logged-in user. Defaults to a fixed test JID. */
  userJid?: string
  userLid?: string
  userName?: string
  /** Enable group-related socket methods for group tests. */
  withGroupStubs?: boolean
}

/**
 * Returns a minimal Baileys socket stub.
 * Only mocks the surface area a given test actually needs.
 * Use `withGroupStubs: true` for tests that exercise group-participant logic.
 */
export function createMockSocket(options: MockSocketOptions = {}) {
  const {
    userJid = '919931386969@s.whatsapp.net',
    userLid = '919931386969@lid',
    userName = 'Me',
    withGroupStubs = false
  } = options

  const base = {
    user: { id: userJid, lid: userLid, name: userName },
    ev: {
      on: vi.fn(),
      off: vi.fn(),
      process: vi.fn()
    },
    sendMessage: vi.fn().mockResolvedValue({ key: { id: 'test-sent-id' } }),
    profilePictureUrl: vi.fn().mockResolvedValue('http://mock-pfp'),
    updateMediaMessage: vi.fn().mockResolvedValue({}),
    signalRepository: {
      lidMapping: {
        getPNForLID: vi.fn().mockResolvedValue(null)
      }
    }
  }

  if (withGroupStubs) {
    return {
      ...base,
      groupFetchAllParticipating: vi.fn().mockResolvedValue({}),
      groupMetadata: vi.fn().mockImplementation((jid: string) =>
        Promise.resolve({ id: jid, subject: 'Mock Group', participants: [] })
      )
    } as any
  }

  return base as any
}

// ── Service Container ────────────────────────────────────────────────────────

/**
 * Constructs the full production-equivalent service graph against the test DB.
 * Returns a typed ServiceContainer so tests depend on the interface, not `any`.
 */
export function createTestServiceContainer(
  prisma: PrismaClient,
  bus: IWAEventBus
): ServiceContainer {
  const mockWindow = {
    isDestroyed: () => false,
    isFocused: () => false,
    webContents: { send: vi.fn() }
  } as any

  const services = createServices(prisma, () => mockWindow, () => bus, () => null)
  createSubscribers(bus, services, () => mockWindow)

  return services
}

// ── Event Injector ───────────────────────────────────────────────────────────

type EventDispatcher = (
  payload: any,
  services: ServiceContainer,
  handler: WAEventHandler,
  sock: any
) => Promise<void>

/**
 * Registry of event name → dispatcher function.
 * To support a new Baileys event, add one entry here — no if/else chain to modify.
 */
const EVENT_REGISTRY: Record<string, EventDispatcher> = {
  'messaging-history.set': (p, s, _, sock) => s.historySyncManager.handleSyncChunk(p, false, sock),
  'messages.upsert':        (p, _, h, sock) => h.handleMessagesUpsert(p, sock),
  'messages.update':        (p, _, h, sock) => h.handleMessagesUpdate(p, sock),
  'messages.reaction':      (p, _, h, sock) => h.handleMessagesReaction(p, sock),
  'message-receipt.update': (p, _, h, sock) => h.handleMessageReceiptUpdate(p, sock),
  'chats.update':           (p, _, h)       => h.handleChatsUpdate(p),
  'chats.upsert':           (p, _, h)       => h.handleChatsUpsert(p),
  'contacts.upsert':        (p, _, h)       => h.handleContactsUpsert(p),
  'contacts.update':        (p, _, h)       => h.handleContactsUpdate(p),
  'lid-mapping.update':     (p, _, h)       => h.handleLidMappingUpdate(p),
  'groups.update':          (p, _, h)       => h.handleGroupsUpdate(p),
  'group-participants.update': (p, _, h)    => h.handleGroupParticipantsUpdate(p),
}

/**
 * Dispatches a mock Baileys event into the production service pipeline.
 * Throws if an unregistered event name is used — preventing silent test misconfiguration.
 */
export async function injectEvent(
  event: string,
  payload: any,
  services: ServiceContainer,
  eventHandler: WAEventHandler,
  sock: any
): Promise<void> {
  const dispatcher = EVENT_REGISTRY[event]
  if (!dispatcher) {
    throw new Error(
      `[injectEvent] No dispatcher registered for event "${event}". ` +
      `Register it in EVENT_REGISTRY in helpers.ts.`
    )
  }
  await dispatcher(payload, services, eventHandler, sock)
}
