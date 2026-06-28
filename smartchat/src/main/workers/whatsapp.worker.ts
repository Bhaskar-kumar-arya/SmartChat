import { parentPort } from 'worker_threads'
import { PrismaClient } from '@prisma/client'
import { PrismaBetterSqlite3 } from '@prisma/adapter-better-sqlite3'
import makeWASocketImport, {
  fetchLatestBaileysVersion,
  Browsers,
  DisconnectReason
} from '@whiskeysockets/baileys'
import { Boom } from '@hapi/boom'
import NodeCache from 'node-cache'
import * as fs from 'fs'
import { join } from 'path'

import { WorkerCommandMessage } from './whatsappWorker.types'
import { useLocalPrismaAuthState } from './useLocalPrismaAuthState'
import { bootstrapWorkerRepositories } from './bootstrapWorkerRepositories'
import {
  RECONNECT_DELAY_RESTART_MS,
  RECONNECT_DELAY_DEFAULT_MS
} from '../constants'

function restoreBuffers(obj: any): any {
  if (!obj || typeof obj !== 'object') {
    return obj
  }
  
  if (obj instanceof Uint8Array) {
    return Buffer.from(obj.buffer, obj.byteOffset, obj.byteLength)
  }

  if (Array.isArray(obj)) {
    return obj.map(restoreBuffers)
  }

  const restored: any = {}
  for (const [key, value] of Object.entries(obj)) {
    restored[key] = restoreBuffers(value)
  }
  return restored
}

function sanitizeForPostMessage(val: any, seen = new WeakSet()): any {
  if (val === null || val === undefined) return val

  const t = typeof val
  if (t === 'function' || t === 'symbol') {
    return undefined
  }

  if (t === 'bigint') {
    return Number(val)
  }

  if (t !== 'object') {
    return val
  }

  if (val instanceof Date) {
    return new Date(val.getTime())
  }
  if (val instanceof RegExp) {
    return new RegExp(val)
  }
  if (val instanceof Uint8Array || Buffer.isBuffer(val)) {
    return val
  }

  if (seen.has(val)) {
    return undefined
  }
  seen.add(val)

  if (Array.isArray(val)) {
    const arr: any[] = []
    for (const item of val) {
      const sanitized = sanitizeForPostMessage(item, seen)
      if (sanitized !== undefined) {
        arr.push(sanitized)
      } else {
        arr.push(null)
      }
    }
    seen.delete(val)
    return arr
  }

  const cleaned: Record<string, any> = {}
  for (const [key, value] of Object.entries(val)) {
    const sanitized = sanitizeForPostMessage(value, seen)
    if (sanitized !== undefined) {
      cleaned[key] = sanitized
    }
  }
  seen.delete(val)
  return cleaned
}

const makeWASocket = (typeof makeWASocketImport === 'function'
  ? makeWASocketImport
  : (makeWASocketImport as unknown as { default: typeof makeWASocketImport }).default) as typeof makeWASocketImport

let prisma: PrismaClient | null = null
let sock: any = null
let repos: ReturnType<typeof bootstrapWorkerRepositories> | null = null
let reconnectTimeout: NodeJS.Timeout | null = null
let isFreshLogin = false
let syncFullHistory = false
let shouldSyncHistory = false
let dbPath = ''
let userDataPath = ''

async function wipeAllData(prismaClient: PrismaClient, userPath: string): Promise<void> {
  await prismaClient.reaction.deleteMany()
  await prismaClient.messageVector.deleteMany()
  await prismaClient.message.deleteMany()
  await prismaClient.chatMember.deleteMany()
  await prismaClient.chat.deleteMany()
  await prismaClient.community.deleteMany()
  await prismaClient.identityAlias.deleteMany()
  await prismaClient.identity.deleteMany()
  await prismaClient.authState.deleteMany()
  await prismaClient.favoriteSticker.deleteMany().catch((err) => {
    console.error('[WhatsAppWorker] Failed to wipe favoriteSticker:', err)
  })

  try {
    const favsDir = join(userPath, 'favourites')
    if (fs.existsSync(favsDir)) {
      const files = fs.readdirSync(favsDir)
      for (const file of files) {
        try {
          fs.unlinkSync(join(favsDir, file))
        } catch (err) {
          console.error('[WhatsAppWorker] Failed to unlink favourite file:', err)
        }
      }
    }
  } catch (e) {
    console.error('[WhatsAppWorker] Failed to clear favourites folder:', e)
  }
  console.log('[WhatsAppWorker] All database tables cleared (including AuthState).')
}

async function connect() {
  if (reconnectTimeout) {
    clearTimeout(reconnectTimeout)
    reconnectTimeout = null
  }

  if (sock) {
    console.log('[WhatsAppWorker] Cleaning up previous socket instance before reconnecting...')
    try {
      const ev = sock.ev as unknown as { removeAllListeners?: () => void }
      ev.removeAllListeners?.()
      sock.end(new Error('Replaced by new socket instance'))
    } catch (err) {
      console.warn('[WhatsAppWorker] Error cleaning up old socket:', err)
    }
    sock = null
  }

  const existingCreds = await repos!.authSettingsService.hasCreds()
  if (!existingCreds) {
    isFreshLogin = true
    await repos!.authSettingsService.clearHistorySyncCompleted().catch((err) => {
      console.error('[WhatsAppWorker] failed to delete history_sync_completed flag:', err)
    })

    const orphanChats = await prisma!.chat.count()
    if (orphanChats > 0) {
      console.log(`[WhatsAppWorker] No auth creds but found ${orphanChats} orphan chats — wiping stale data`)
      await wipeAllData(prisma!, userDataPath)
    }
  }

  const { state, saveCreds } = await useLocalPrismaAuthState(prisma!)
  let version: [number, number, number] = [2, 3000, 1035194821]
  try {
    console.log('[WhatsAppWorker] Fetching latest WhatsApp version from Baileys...')
    const latest = await fetchLatestBaileysVersion()
    version = latest.version as [number, number, number]
    console.log(`[WhatsAppWorker] Successfully fetched WA v${version.join('.')}`)
  } catch (err) {
    console.warn('[WhatsAppWorker] Failed to fetch latest WhatsApp version (possibly offline). Using fallback version.', err)
  }

  if (isFreshLogin) {
    await repos!.authSettingsService.clearHistorySyncCompleted().catch((err) => {
      console.error('[WhatsAppWorker] fresh login authState deletion failed:', err)
    })
  }

  const isHistorySyncCompleted = await repos!.authSettingsService.getHistorySyncCompleted()

  repos!.historySyncManager.clear()

  const isInitialSyncInProgress = repos!.historySyncManager.isInProgress
  const currentShouldSyncHistory = isFreshLogin || isInitialSyncInProgress || !isHistorySyncCompleted

  const groupCache = new NodeCache({ stdTTL: 5 * 60, useClones: false })

  sock = makeWASocket({
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
        const msg = await prisma!.message.findUnique({ where: { id: key.id } })
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

  sock.ev.on('creds.update', saveCreds)

  sock.ev.process(async (events) => {
    if (events['connection.update']) {
      const update = events['connection.update']
      const { connection, lastDisconnect, qr } = update

      if (qr) {
        console.log('[WhatsAppWorker] Got QR string:', qr)
        isFreshLogin = true
        parentPort?.postMessage({
          type: 'domain_event',
          payload: { event: 'wa-qr', data: qr }
        })
      }

      if (connection === 'close') {
        const lastDisconnectObj = lastDisconnect as Record<string, unknown> | null | undefined
        const statusCode = (lastDisconnectObj?.error as Boom | undefined)?.output?.statusCode
        const errorData = (lastDisconnectObj?.error as Record<string, unknown> | undefined)?.data as Record<string, unknown> | undefined
        const isConflict = statusCode === 440 || statusCode === 409 || errorData?.tag === 'conflict'
        const isRestartRequired = statusCode === DisconnectReason.restartRequired
        const shouldReconnect = (statusCode !== DisconnectReason.loggedOut && !isConflict) || isRestartRequired

        console.log(`[WhatsAppWorker] Closed | statusCode=${statusCode} | isRestart=${isRestartRequired} | isConflict=${isConflict} | shouldReconnect=${shouldReconnect}`)

        if (shouldReconnect) {
          const delay = isRestartRequired ? RECONNECT_DELAY_RESTART_MS : RECONNECT_DELAY_DEFAULT_MS
          console.log(`[WhatsAppWorker] Scheduling reconnect in ${delay}ms...`)
          reconnectTimeout = setTimeout(() => connect(), delay)
        } else if (isConflict) {
          console.warn('[WhatsAppWorker] Replaced by another session (440 conflict). Standing down.')
        } else {
          console.log('[WhatsAppWorker] Logged out — wiping all data for fresh QR...')
          try {
            await wipeAllData(prisma!, userDataPath)
          } catch (err) {
            console.error('[WhatsAppWorker] Error wiping data:', err)
          }
          isFreshLogin = true
          parentPort?.postMessage({
            type: 'domain_event',
            payload: { event: 'wa-logged-out' }
          })
          connect()
        }
      } else if (connection === 'open') {
        console.log('[WhatsAppWorker] Connected to WhatsApp!')
        if (sock.user) {
          await repos!.contactService.registerMe(sock.user).catch((err) => {
            console.error('[WhatsAppWorker] Failed to register logged-in user identity:', err)
          })
        }

        const isSyncInProgress = repos!.historySyncManager.isInProgress
        if (!isFreshLogin && !isSyncInProgress) {
          const isHistorySyncCompleted = await repos!.authSettingsService.getHistorySyncCompleted()

          if (isHistorySyncCompleted) {
            parentPort?.postMessage({
              type: 'domain_event',
              payload: {
                event: 'wa-sync-progress',
                data: { progress: 100, syncType: 6, syncFullHistory }
              }
            })
            parentPort?.postMessage({
              type: 'domain_event',
              payload: { event: 'wa-sync-complete' }
            })
          } else {
            console.log('[WhatsAppWorker] Reconnect: history sync NOT completed, continuing sync')
            parentPort?.postMessage({
              type: 'domain_event',
              payload: { event: 'wa-connected' }
            })
          }
        } else {
          console.log('[WhatsAppWorker] Fresh login or active sync reconnect detected, showing/continuing sync screen')
          repos!.historySyncManager.setInProgress(true)
          isFreshLogin = false
          parentPort?.postMessage({
            type: 'domain_event',
            payload: { event: 'wa-connected' }
          })
        }
      }

      const safeUpdate: any = { ...update }
      if (safeUpdate.lastDisconnect) {
        const errorObj = safeUpdate.lastDisconnect.error as any
        safeUpdate.lastDisconnect = {
          ...safeUpdate.lastDisconnect,
          error: errorObj
            ? {
                message: errorObj.message || String(errorObj),
                stack: errorObj.stack,
                output: errorObj.output || undefined
              }
            : undefined
        }
      }
      parentPort?.postMessage({
        type: 'domain_event',
        payload: { event: 'connection.update', data: safeUpdate }
      })
    }

    if (events['messaging-history.set']) {
      const data = events['messaging-history.set']
      await repos!.historySyncManager.handleSyncChunk(data, syncFullHistory, sock!)
    }

    if (events['messages.upsert']) {
      await repos!.eventHandler.handleMessagesUpsert(events['messages.upsert'], sock!)
    }

    if (events['messages.update']) {
      await repos!.eventHandler.handleMessagesUpdate(events['messages.update'], sock!)
    }

    if (events['contacts.upsert']) {
      await repos!.eventHandler.handleContactsUpsert(events['contacts.upsert'])
    }

    if (events['contacts.update']) {
      await repos!.eventHandler.handleContactsUpdate(events['contacts.update'])
    }

    if (events['lid-mapping.update']) {
      await repos!.eventHandler.handleLidMappingUpdate(events['lid-mapping.update'])
    }

    if (events['chats.update']) {
      await repos!.eventHandler.handleChatsUpdate(events['chats.update'])
    }

    if (events['chats.upsert']) {
      await repos!.eventHandler.handleChatsUpsert(events['chats.upsert'])
    }

    if (events['groups.update']) {
      await repos!.eventHandler.handleGroupsUpdate(events['groups.update'])
    }

    if (events['group-participants.update']) {
      await repos!.eventHandler.handleGroupParticipantsUpdate(events['group-participants.update'])
    }

    if (events['messages.reaction']) {
      await repos!.eventHandler.handleMessagesReaction(events['messages.reaction'], sock!)
    }

    if (events['presence.update']) {
      await repos!.eventHandler.handlePresenceUpdate(events['presence.update'], sock!)
    }

    if (events['message-receipt.update']) {
      await repos!.eventHandler.handleMessageReceiptUpdate(events['message-receipt.update'], sock!)
    }

    if (events['call']) {
      await repos!.eventHandler.handleCallEvent(events['call'])
    }

    if (events['app-state.sync']) {
      const syncEvent = events['app-state.sync']
      const syncEvents = Array.isArray(syncEvent) ? (syncEvent as unknown[]) : [syncEvent]
      await repos!.eventHandler.handleAppStateSync(syncEvents, sock!)
    }
  })
}

parentPort?.on('message', async (msg: unknown) => {
  if (!msg || typeof msg !== 'object') {
    return
  }

  const command = msg as WorkerCommandMessage
  console.log(`[WhatsAppWorker] Received command: ${command.type}`)

  try {
    switch (command.type) {
      case 'init': {
        const { dbPath: receivedDbPath, userDataPath: receivedUserDataPath, syncFullHistory: receivedSyncFullHistory, shouldSyncHistory: receivedShouldSyncHistory } = command.payload
        dbPath = receivedDbPath
        userDataPath = receivedUserDataPath
        syncFullHistory = receivedSyncFullHistory
        shouldSyncHistory = receivedShouldSyncHistory

        console.log(`[WhatsAppWorker] Initializing with dbPath: ${dbPath}, userDataPath: ${userDataPath}, syncFullHistory: ${syncFullHistory}, shouldSyncHistory: ${shouldSyncHistory}`)

        const adapter = new PrismaBetterSqlite3({ url: `file:${dbPath}` })
        prisma = new PrismaClient({ adapter })

        await prisma.$executeRawUnsafe('PRAGMA busy_timeout = 5000;')
        await prisma.$executeRawUnsafe('PRAGMA journal_mode = WAL;')
        await prisma.$executeRawUnsafe('PRAGMA synchronous = NORMAL;')

        repos = bootstrapWorkerRepositories(
          prisma,
          userDataPath,
          (event, data) => {
            parentPort?.postMessage({
              type: 'domain_event',
              payload: { event, data: sanitizeForPostMessage(data) }
            })
          },
          () => sock
        )

        const originalEmit = repos.eventBus.emit.bind(repos.eventBus)
        repos.eventBus.emit = async (event, data) => {
          if (event !== 'app-state:sync') {
            let safeData = data
            if (data && typeof data === 'object') {
              if ('sock' in data) {
                const { sock, ...rest } = data as any
                safeData = rest
              }
            }
            parentPort?.postMessage({
              type: 'domain_event',
              payload: { event, data: sanitizeForPostMessage(safeData) }
            })
          }
          await originalEmit(event, data)
        }

        await connect()

        parentPort?.postMessage({
          type: 'reply',
          correlationId: command.correlationId,
          payload: { result: { status: 'initialized' } }
        })
        break
      }

      case 'send_message': {
        if (!sock) throw new Error('Socket not initialized')
        const { jid, content, options } = command.payload
        const restoredContent = restoreBuffers(content)
        const restoredOptions = restoreBuffers(options)
        const result = await sock.sendMessage(jid, restoredContent as any, restoredOptions as any)
        parentPort?.postMessage({
          type: 'reply',
          correlationId: command.correlationId,
          payload: { result }
        })
        break
      }

      case 'read_messages': {
        if (!sock) throw new Error('Socket not initialized')
        const { keys } = command.payload
        await sock.readMessages(keys as any)
        parentPort?.postMessage({
          type: 'reply',
          correlationId: command.correlationId,
          payload: { result: { status: 'success' } }
        })
        break
      }

      case 'chat_modify': {
        if (!sock) throw new Error('Socket not initialized')
        const { jid, modification } = command.payload
        await sock.chatModify(modification as any, jid)
        parentPort?.postMessage({
          type: 'reply',
          correlationId: command.correlationId,
          payload: { result: { status: 'success' } }
        })
        break
      }

      case 'group_fetch_all': {
        if (!sock) throw new Error('Socket not initialized')
        const groups = await sock.groupFetchAllParticipating()
        parentPort?.postMessage({
          type: 'reply',
          correlationId: command.correlationId,
          payload: { result: { groups } }
        })
        break
      }

      case 'get_pn_for_lid': {
        if (!sock) throw new Error('Socket not initialized')
        const { lid } = command.payload
        const pn = await sock.signalRepository?.lidMapping?.getPNForLID?.(lid)
        parentPort?.postMessage({
          type: 'reply',
          correlationId: command.correlationId,
          payload: { result: pn }
        })
        break
      }

      case 'profile_picture_url': {
        if (!sock) throw new Error('Socket not initialized')
        const { jid, type } = command.payload
        const url = await sock.profilePictureUrl(jid, type)
        parentPort?.postMessage({
          type: 'reply',
          correlationId: command.correlationId,
          payload: { result: url }
        })
        break
      }

      case 'group_metadata': {
        if (!sock) throw new Error('Socket not initialized')
        const { jid } = command.payload
        const result = await sock.groupMetadata(jid)
        parentPort?.postMessage({
          type: 'reply',
          correlationId: command.correlationId,
          payload: { result }
        })
        break
      }

      case 'logout': {
        if (!sock) throw new Error('Socket not initialized')
        await sock.logout()
        parentPort?.postMessage({
          type: 'reply',
          correlationId: command.correlationId,
          payload: { result: { status: 'success' } }
        })
        break
      }

      case 'skip_sync': {
        if (!sock) throw new Error('Socket not initialized')
        await repos!.historySyncManager.skipSync(sock)
        parentPort?.postMessage({
          type: 'reply',
          correlationId: command.correlationId,
          payload: { result: { status: 'success' } }
        })
        break
      }

      default: {
        const exhaustiveCheck: never = command
        console.warn(`[WhatsAppWorker] Unknown command: ${exhaustiveCheck}`)
      }
    }
  } catch (err: unknown) {
    const errorVal = err as Error
    console.error(`[WhatsAppWorker] Error processing command ${command.type}:`, errorVal)
    parentPort?.postMessage({
      type: 'reply_error',
      correlationId: command.correlationId,
      error: errorVal.message || String(errorVal)
    })
  }
})
