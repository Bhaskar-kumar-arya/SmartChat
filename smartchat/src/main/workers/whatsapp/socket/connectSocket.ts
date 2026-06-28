import makeWASocketImport, { Browsers } from '@whiskeysockets/baileys'
import type { WASocket, AuthenticationState } from '@whiskeysockets/baileys'
import { PrismaClient } from '@prisma/client'
import NodeCache from 'node-cache'

const makeWASocket = (typeof makeWASocketImport === 'function'
  ? makeWASocketImport
  : (makeWASocketImport as unknown as { default: typeof makeWASocketImport }).default) as typeof makeWASocketImport

export interface ConnectSocketOptions {
  version: [number, number, number]
  state: AuthenticationState
  syncFullHistory: boolean
  currentShouldSyncHistory: boolean
  groupCache: NodeCache
  prisma: PrismaClient
}

/**
 * Creates and configures a new Baileys WASocket instance.
 */
export function connectSocket({
  version,
  state,
  syncFullHistory,
  currentShouldSyncHistory,
  groupCache,
  prisma
}: ConnectSocketOptions): WASocket {
  const sock = makeWASocket({
    version,
    auth: state,
    printQRInTerminal: false,
    generateHighQualityLinkPreview: true,
    browser: Browsers.macOS('Desktop'),
    syncFullHistory,
    shouldSyncHistoryMessage: () => currentShouldSyncHistory,
    cachedGroupMetadata: async (jid) => groupCache.get(jid) ?? undefined,
    getMessage: async (key) => {
      if (!key.id) return undefined
      try {
        const msg = await prisma.message.findUnique({ where: { id: key.id } })
        if (msg && msg.content) {
          return JSON.parse(msg.content)
        }
      } catch (err) {
        console.error('[WhatsAppWorker] Error fetching message for retry/reaction:', err)
      }
      return undefined
    }
  })

  try {
    const evTarget = sock.ev as unknown as {
      target?: { setMaxListeners?: (n: number) => void }
      setMaxListeners?: (n: number) => void
    }
    if (evTarget.target?.setMaxListeners) {
      evTarget.target.setMaxListeners(100)
    } else if (evTarget.setMaxListeners) {
      evTarget.setMaxListeners(100)
    }
  } catch (err) {
    console.warn('[WhatsAppWorker] Failed to set max listeners:', err)
  }

  return sock
}
