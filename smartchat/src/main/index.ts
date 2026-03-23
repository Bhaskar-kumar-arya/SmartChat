import { app, shell, BrowserWindow, ipcMain, protocol, net } from 'electron'
import { join } from 'path'
import { pathToFileURL } from 'url'
import fs from 'fs'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'
import icon from '../../resources/icon.png?asset'
import baileys, { DisconnectReason, fetchLatestBaileysVersion } from '@whiskeysockets/baileys'
const makeWASocket = (baileys as any).default || baileys;
import { Boom } from '@hapi/boom'
import { usePrismaAuthState, prisma } from './auth'
import { handleHistorySync } from './historySync'
import { registerIpcHandlers } from './ipcHandlers'
import { Browsers } from '@whiskeysockets/baileys'
import NodeCache from 'node-cache'
import { contactService } from './services/ContactService'
import { messageService } from './services/MessageService'
import { chatService } from './services/ChatService'

// Register 'app' protocol as privileged BEFORE app is ready
protocol.registerSchemesAsPrivileged([
  { scheme: 'app', privileges: { secure: true, standard: true, supportFetchAPI: true, stream: true } }
])

// Module-level socket reference so IPC handlers can access it
let currentSock: ReturnType<typeof makeWASocket> | null = null
const getSock = () => currentSock

let globalReconnectTimeout: ReturnType<typeof setTimeout> | null = null
let globalSyncTimeoutHandle: ReturnType<typeof setTimeout> | null = null

let mainWindow: BrowserWindow | null = null
let currentFinishSync: (() => void) | null = null
let isFreshLogin = false

async function connectToWhatsApp(window: BrowserWindow) {
  // Clear any existing reconnect timeout
  if (globalReconnectTimeout) {
    clearTimeout(globalReconnectTimeout)
    globalReconnectTimeout = null
  }

  // Gracefully shut down existing socket
  if (currentSock) {
    console.log('[Connection] Cleaning up previous socket instance before reconnecting...')
    try {
      currentSock.ev.removeAllListeners()
      currentSock.end(new Error('Replaced by new socket instance'))
    } catch (err) {
      console.warn('[Connection] Error cleaning up old socket:', err)
    }
    currentSock = null
  }

  // Clean up orphan data if not logged in
  const existingCreds = await prisma.authState.findUnique({ where: { id: 'creds' } })
  if (!existingCreds) {
    const orphanChats = await prisma.chat.count()
    if (orphanChats > 0) {
      console.log(`[Cleanup] No auth creds but found ${orphanChats} orphan chats — wiping stale data`)
      await prisma.message.deleteMany()
      await prisma.chat.deleteMany()
      await prisma.contact.deleteMany()
    }
  }

  const { state, saveCreds } = await usePrismaAuthState()
  const { version, isLatest } = await fetchLatestBaileysVersion()
  console.log(`using WA v${version.join('.')}, isLatest: ${isLatest}`)
  const groupCache = new NodeCache({ stdTTL: 5 * 60, useClones: false })
  const sock = makeWASocket({
    version,
    auth: state,
    printQRInTerminal: false,
    generateHighQualityLinkPreview: true,
    browser: Browsers.macOS('Desktop'),
    syncFullHistory: true,
    shouldSyncHistoryMessage: () => true,
    cachedGroupMetadata: async (jid) => groupCache.get(jid),
    getMessage: async (key) => {
      if (!key.id) return undefined;
      try {
        const msg = await prisma.message.findUnique({ where: { id: key.id } });
        if (msg && msg.content) {
          return JSON.parse(msg.content);
        }
      } catch (err) {
        console.error('Error fetching message for retry/reaction:', err);
      }
      return undefined;
    }
  })

  // Store socket reference for IPC handlers
  currentSock = sock

  // Watch for auth state changes
  sock.ev.on('creds.update', saveCreds)

  // Watch for connection updates
  sock.ev.on('connection.update', async (update) => {
    const { connection, lastDisconnect, qr } = update

    if (qr) {
      console.log('Got QR string:', qr)
      isFreshLogin = true  // Mark as fresh login — must go through sync
      // Send QR string to renderer process via IPC
      if (!window.isDestroyed()) {
        window.webContents.send('wa-qr', qr)
      }
    }

    if (connection === 'close') {
      const statusCode = (lastDisconnect?.error as Boom)?.output?.statusCode
      const errorData = (lastDisconnect?.error as any)?.data
      const isConflict = statusCode === 440 || statusCode === 409 || errorData?.tag === 'conflict'
      const isRestartRequired = statusCode === DisconnectReason.restartRequired
      const shouldReconnect = (statusCode !== DisconnectReason.loggedOut && !isConflict) || isRestartRequired

      console.log(`[Connection] Closed | statusCode=${statusCode} | isRestart=${isRestartRequired} | isConflict=${isConflict} | shouldReconnect=${shouldReconnect} | error=`, lastDisconnect?.error)

      if (shouldReconnect) {
        // restartRequired needs immediate attention, others get a 3s breather
        const delay = isRestartRequired ? 500 : 3000
        console.log(`[Connection] Scheduling reconnect in ${delay}ms...`)
        globalReconnectTimeout = setTimeout(() => connectToWhatsApp(window), delay)
      } else if (isConflict) {
        console.warn('[Connection] Replaced by another session (440 conflict). Standing down.')
      } else {
        // Logged out — wipe ALL data from database and reconnect for fresh QR
        console.log('Logged out — wiping all data for fresh QR...')
        try {
          await prisma.message.deleteMany()
          await prisma.chat.deleteMany()
          await prisma.contact.deleteMany()
          await prisma.authState.deleteMany()
        } catch (err) {
          console.error('Error wiping data:', err)
        }
        isFreshLogin = true
        if (!window.isDestroyed()) {
          window.webContents.send('wa-logged-out')
        }
        // Reconnect to trigger a fresh QR code
        connectToWhatsApp(window)
      }
    } else if (connection === 'open') {
      console.log('Connected to WhatsApp!')
      if (!window.isDestroyed()) {
        if (!isFreshLogin) {
          // Reconnection — check if we already have synced data
          const chatCount = await prisma.chat.count()
          if (chatCount > 0) {
            console.log(`[Connection] Reconnect: found ${chatCount} existing chats, skipping sync`)
            window.webContents.send('wa-sync-progress', 100)
            window.webContents.send('wa-sync-complete')
          } else {
            window.webContents.send('wa-connected')
          }
        } else {
          // Fresh login after QR scan — always show sync screen
          console.log('[Connection] Fresh login detected, showing sync screen')
          isFreshLogin = false
          window.webContents.send('wa-connected')
        }
      }
    }
  })

  // ── History Sync (Phase 2) ──────────────────────────────────────────
  let syncChunkCount = 0
  let maxProgress = 0
  let syncComplete = false

  const finishSync = () => {
    if (syncComplete) return
    syncComplete = true
    console.log(`[HistorySync] Sync complete after ${syncChunkCount} chunks`)
    if (!window.isDestroyed()) {
      window.webContents.send('wa-sync-progress', 100)
      window.webContents.send('wa-sync-complete')
    }
  }
  currentFinishSync = finishSync

  sock.ev.on('messaging-history.set', async (data) => {
    try {
      syncChunkCount++
      const rawData = data as Record<string, unknown>
      const reportedProgress = typeof rawData.progress === 'number' ? rawData.progress : undefined
      const isLatest = rawData.isLatest === true

      console.log(`[HistorySync] Chunk #${syncChunkCount} received | reportedProgress=${reportedProgress} | isLatest=${isLatest} | keys=${Object.keys(rawData).join(',')}`)

      // Reset the inactivity timeout
      if (globalSyncTimeoutHandle) clearTimeout(globalSyncTimeoutHandle)
      globalSyncTimeoutHandle = setTimeout(finishSync, 180_000)

      await handleHistorySync(
        data as unknown as Parameters<typeof handleHistorySync>[0],
        prisma
      )

      if (!window.isDestroyed() && !syncComplete) {
        const estimated = reportedProgress ?? Math.min(syncChunkCount * 15, 95)
        maxProgress = Math.max(maxProgress, estimated)
        window.webContents.send('wa-sync-progress', maxProgress)
      }
    } catch (err) {
      console.error('[HistorySync] Error processing sync payload:', err)
    }
  })

  // ── Real-Time Messages (Phase 3 & 4) ──────────────────────────────
  sock.ev.on('messages.upsert', async (upsert) => {
    const { messages, type } = upsert

    for (const msg of messages) {
      try {
        const processed = await messageService.processMessage(msg, sock)
        if (!processed) continue

        const { remoteJid, timestamp, messageType, participant } = processed

        if (type === 'notify') {
          if (!processed.fromMe) {
            if (messageType !== 'reactionMessage') {
              await chatService.incrementUnread(remoteJid, timestamp)
            }
          } else if (messageType !== 'reactionMessage') {
            await chatService.updateTimestamp(remoteJid, timestamp)
          }

          if (mainWindow && !mainWindow.isDestroyed()) {
            const jids = new Set<string>([participant || remoteJid])
            const nameMap = await contactService.batchResolveNames(Array.from(jids), sock)
            const enriched = await messageService.enrichMessage(processed, sock, nameMap)
            mainWindow.webContents.send('new-message', enriched)
          }
        } else {
          await chatService.updateTimestamp(remoteJid, timestamp)
        }
      } catch (err) {
        console.error('[messages.upsert] Error processing message:', err)
      }
    }
  })

  // ── Contacts Events ───────────────────────────────────────────────────
  sock.ev.on('contacts.upsert', async (contacts) => {
    for (const contact of contacts) {
      await contactService.upsertContact(contact).catch(() => {})
    }
  })

  sock.ev.on('contacts.update', async (updates) => {
    for (const contact of updates) {
      await contactService.upsertContact(contact, { overwriteName: true }).catch(() => {})
    }
  })

  sock.ev.on('lid-mapping.update', async (mappings) => {
    for (const mapping of mappings) {
      const { lid, pn } = mapping
      if (lid && pn) await contactService.linkLidAndPn(lid, pn).catch(() => {})
    }
  })

  // ── Chats Events ─────────────────────────────────────────────────────
  sock.ev.on('chats.update', async (updates) => {
    for (const update of updates) {
      const jid = update.id
      if (jid) {
          await chatService.upsertChat(jid, update).catch(() => {})
          if (!window.isDestroyed()) {
              // Map BigInt to string before sending to renderer
              const formatted: any = {}
              for (const [key, val] of Object.entries(update)) {
                  formatted[key] = typeof val === 'bigint' ? val.toString() : val
              }
              window.webContents.send('chat-updated', { jid, ...formatted })
          }
      }
    }
  })

  sock.ev.on('chats.upsert', async (newChats) => {
    for (const chat of newChats) {
      const jid = chat.id
      if (jid) await chatService.upsertChat(jid, chat).catch(() => {})
    }
  })

  // ── Presence Update ──────────────────────────────────────────────
  sock.ev.on('presence.update', async (update) => {
    const { id, presences } = update
    
    if (mainWindow && !mainWindow.isDestroyed()) {
      const jids = Object.keys(presences)
      const nameMap = await contactService.batchResolveNames(jids, sock)
      
      const enrichedPresences = Object.entries(presences).map(([participantJid, status]) => {
          const s = status as any
          return [
            participantJid,
            {
              ...s,
              name: nameMap.get(participantJid) || participantJid.replace(/@.*$/, ''),
              lastSeen: s.lastSeen ? s.lastSeen.toString() : undefined,
              timestamp: Date.now()
            }
          ]
      })

      mainWindow.webContents.send('presence-update', {
        remoteJid: id,
        presences: Object.fromEntries(enrichedPresences)
      })
    }
  })
}

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 900,
    height: 670,
    show: false,
    autoHideMenuBar: true,
    ...(process.platform === 'linux' ? { icon } : {}),
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false
    }
  })

  mainWindow.on('ready-to-show', () => {
    if (mainWindow) {
      mainWindow.show()
      connectToWhatsApp(mainWindow)
    }
  })

  mainWindow.webContents.setWindowOpenHandler((details) => {
    shell.openExternal(details.url)
    return { action: 'deny' }
  })

  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

app.whenReady().then(() => {
  electronApp.setAppUserModelId('com.electron')

  protocol.handle('app', async (request) => {
    try {
      const { host, pathname } = new URL(request.url)
      if (host === 'media') {
        const fileName = pathname.startsWith('/') ? pathname.slice(1) : pathname
        const filePath = join(app.getPath('userData'), 'media', fileName)
        
        if (fs.existsSync(filePath)) {
          return net.fetch(pathToFileURL(filePath).href)
        }
      }
    } catch (err) {
      console.error('[Protocol] Error handling app:// request:', err)
    }
    return new Response('Not Found', { status: 404 })
  })

  app.on('browser-window-created', (_, window) => {
    optimizer.watchWindowShortcuts(window)
  })

  ipcMain.on('ping', () => console.log('pong'))

  registerIpcHandlers(prisma, getSock)

  ipcMain.on('wa-skip-sync', () => {
    if (currentFinishSync) currentFinishSync()
  })

  createWindow()

  app.on('activate', function () {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})
