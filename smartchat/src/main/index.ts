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
import { registerIpcHandlers, resolveContactName } from './ipcHandlers'
import { Browsers } from '@whiskeysockets/baileys'
import NodeCache from 'node-cache'

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
  let contactsUpsertCount = 0
  let contactsUpdateCount = 0

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

      // Reset the inactivity timeout — if no new chunk arrives within 60s, mark sync done
      if (globalSyncTimeoutHandle) clearTimeout(globalSyncTimeoutHandle)
      globalSyncTimeoutHandle = setTimeout(finishSync, 180_000)

      // Save raw data to disk for debugging
      try {
        const debugDir = join(process.cwd(), 'debug')
        if (!fs.existsSync(debugDir)) {
          fs.mkdirSync(debugDir, { recursive: true })
        }
        const filePath = join(debugDir, `history_sync_chunk_${syncChunkCount}.json`)
        fs.writeFileSync(filePath, JSON.stringify(data, (_, value) =>
          typeof value === 'bigint' ? value.toString() : value
          , 2))
        console.log(`[HistorySync] Saved raw chunk #${syncChunkCount} to ${filePath}`)
      } catch (saveErr) {
        console.error('[HistorySync] Failed to save raw chunk to disk:', saveErr)
      }

      await handleHistorySync(
        data as unknown as Parameters<typeof handleHistorySync>[0],
        prisma
      )

      if (!window.isDestroyed() && !syncComplete) {
        // Calculate progress: only move forward, never backward
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
        const key = msg.key
        if (!key?.id) continue

        // Strip Protobuf class methods safely
        let rawMessage: any = null
        if (msg.message) {
          try {
            rawMessage = JSON.parse(JSON.stringify(msg.message))
          } catch (err) {
            // Fallback: If protobuf toJSON crashes (e.g., broken Long types in quoted messages)
            const safeStringify = (obj: any) => JSON.stringify(obj, (_key, value) => {
              if (value && typeof value === 'object' && typeof value.toJSON === 'function') {
                try { return value.toJSON() } 
                catch (e) { 
                  const copy: any = {}
                  for (const k in value) { if (typeof value[k] !== 'function') copy[k] = value[k] }
                  return copy
                }
              }
              return value
            })
            rawMessage = JSON.parse(safeStringify(msg.message))
          }
        }
        const remoteJid = key.remoteJid || ''
        const participant = key.participant || null

        // 1. Extract text content for fast SQL searching
        let textContent: string | null = null
        if (rawMessage) {
          if (typeof rawMessage.conversation === 'string') {
            textContent = rawMessage.conversation
          } else {
            const extText = rawMessage.extendedTextMessage as Record<string, unknown> | undefined
            if (extText && typeof extText.text === 'string') {
              textContent = extText.text
            }
          }
        }

        // 2. Determine high-level message type
        let messageType = 'unknown'
        if (rawMessage) {
          const typeKeys = [
            'conversation', 'extendedTextMessage', 'imageMessage',
            'videoMessage', 'audioMessage', 'documentMessage',
            'stickerMessage', 'contactMessage', 'locationMessage',
            'reactionMessage', 'protocolMessage'
          ]
          for (const k of typeKeys) {
            if (rawMessage[k] !== undefined && rawMessage[k] !== null) {
              messageType = k
              break
            }
          }
        }

        // 3. Parse Timestamp
        const ts = msg.messageTimestamp ?? 0
        const timestamp = BigInt(
          typeof ts === 'object' && ts !== null && 'low' in (ts as Record<string, unknown>)
            ? ((ts as Record<string, unknown>).low as number)
            : (ts as number)
        )

        // ── THE FIX: Golden Ticket LID -> PN Mapping ──
        // If WhatsApp decides to expose the phone number for a LID, it will be here.
        const altJid = (key as any).participantAlt || (key as any).remoteJidAlt;
        if (altJid) {
          const currentLid = participant?.includes('@lid') ? participant : (remoteJid?.includes('@lid') ? remoteJid : null);
          const currentPn = typeof altJid === 'string' && altJid.includes('@s.whatsapp.net') ? altJid : null;

          if (currentLid && currentPn) {
            // Proactively save this mapping immediately to satisfy future queries
            await prisma.contact.upsert({
              where: { id: currentPn },
              update: { lid: currentLid },
              create: { id: currentPn, lid: currentLid }
            }).catch(err => console.error('[Alt Sniffer] Error saving alt mapping:', err));
            console.log(`[Alt Sniffer] Caught active mapping from message: ${currentLid} <-> ${currentPn}`);
          }
        }

        // ── THE FIX: PushName Sniffing ──
        // If they aren't in our address book, grab the name they set for themselves.
        if (msg.pushName) {
          const senderId = participant || remoteJid;
          if (senderId) {
            // Fire and forget - don't await to avoid slowing down the message ingest
            prisma.contact.upsert({
              where: { id: senderId },
              update: { notify: msg.pushName }, // Always update notify (pushName), do not overwrite name
              create: { id: senderId, name: msg.pushName, notify: msg.pushName }
            }).catch(() => { }); // Ignore unique constraint errors in background
          }
        }

        // 4. Determine media message
        if (messageType === 'imageMessage' && rawMessage && rawMessage.imageMessage) {
            // We just leave the media in its encrypted form in the payload.
            // When the user clicks download, the renderer calls the IPC handler.
        }

        // 5. Insert message into SQLite
        if (messageType === 'reactionMessage') {
           const reaction = rawMessage.reactionMessage
           if (reaction && reaction.key && reaction.key.id) {
              const targetId = reaction.key.id
              const emoji = reaction.text
              const senderId = participant || remoteJid
              
              if (!emoji) {
                // Delete reaction if emoji is empty
                await (prisma as any).reaction.deleteMany({
                  where: { messageId: targetId, senderId }
                }).catch(() => {})
              } else {
                // Upsert reaction
                await (prisma as any).reaction.upsert({
                  where: { messageId_senderId: { messageId: targetId, senderId } },
                  update: { text: emoji, timestamp },
                  create: {
                    messageId: targetId,
                    remoteJid,
                    senderId,
                    text: emoji,
                    timestamp
                  }
                }).catch(err => console.error('[Reaction] Error upserting reaction:', err))
              }
           }
        } else {
          // Regular message insert
          await prisma.message.upsert({
            where: { id: key.id },
            update: {
              textContent,
              messageType,
              content: JSON.stringify(rawMessage || {}),
              timestamp
            },
            create: {
              id: key.id,
              remoteJid,
              fromMe: key.fromMe === true,
              participant,
              timestamp,
              messageType,
              content: JSON.stringify(rawMessage || {}),
              textContent
            }
          })
        }

        // 5. Handle UI and Chat Metadata Updates
        if (type === 'notify') {
          // New real-time message — update unread count & dispatch to UI
          if (!key.fromMe) {
            if (messageType !== 'reactionMessage') {
              await prisma.chat.upsert({
                where: { jid: remoteJid },
                update: {
                  unreadCount: { increment: 1 },
                  timestamp
                },
                create: {
                  jid: remoteJid,
                  unreadCount: 1,
                  timestamp
                }
              })
            } else {
               // Reaction from others - just fire IPC event, don't update chat metadata
            }
          } else {
            // Own message — just update the chat timestamp
            if (messageType !== 'reactionMessage') {
              await prisma.chat.upsert({
                where: { jid: remoteJid },
                update: { timestamp },
                create: { jid: remoteJid, unreadCount: 0, timestamp }
              })
            }
          }

          // Fire IPC event so React can update in real-time
          if (mainWindow && !mainWindow.isDestroyed()) {
            const senderId = participant || remoteJid;
            const participantName = await resolveContactName(prisma, senderId, null);
            let finalContent: any = rawMessage || {};
            
            // Resolve quoted participant name on the fly for real-time messages too
            const ctx = finalContent?.extendedTextMessage?.contextInfo || finalContent?.imageMessage?.contextInfo;
            if (ctx?.participant) {
               ctx.participantName = await resolveContactName(prisma, ctx.participant, null);
            }

            mainWindow.webContents.send('new-message', {
              id: key.id,
              remoteJid,
              fromMe: key.fromMe === true,
              participant,
              participantName,
              timestamp: timestamp.toString(),
              messageType,
              textContent,
              content: JSON.stringify(finalContent)
            })
          }
        } else {
          // type === 'append' — background sync, silently ingest
          // Just update the chat timestamp so sort order is correct
          await prisma.chat.upsert({
            where: { jid: remoteJid },
            update: { timestamp },
            create: { jid: remoteJid, unreadCount: 0, timestamp }
          })
        }
      } catch (err) {
        console.error('[messages.upsert] Error processing message:', err)
      }
    }
  })

  // ── Contacts Upsert (Phase 4) ──────────────────────────────────────
  sock.ev.on('contacts.upsert', async (contacts) => {
    try {
      contactsUpsertCount++
      const debugDir = join(process.cwd(), 'debug')
      if (!fs.existsSync(debugDir)) fs.mkdirSync(debugDir, { recursive: true })
      const filePath = join(debugDir, `contacts_upsert_${contactsUpsertCount}.json`)
      fs.writeFileSync(filePath, JSON.stringify(contacts, (_, value) =>
        typeof value === 'bigint' ? value.toString() : value
        , 2))

      console.log(`[Contacts] Received contacts.upsert for ${contacts.length} contacts (saved to ${filePath})`)

      for (const contact of contacts) {
        const id = contact.id as string | undefined
        if (!id) continue

        const lid = (contact as any).lid as string | undefined
        const phoneNumber = (contact as any).phoneNumber as string | undefined
        const newName = (contact as any).name as string | undefined
        const newNotify = ((contact as any).notify ?? (contact as any).pushName) as string | undefined
        const newVerifiedName = (contact as any).verifiedName as string | undefined

        try {
          const existing = await prisma.contact.findUnique({ where: { id } })

          const dataToUpdate: any = {}
          const dataToCreate: any = { id }

          // Only populate 'lid' column for PN-based records to avoid unique constraint violation.
          if (id.endsWith('@s.whatsapp.net')) {
            if (lid) {
              dataToUpdate.lid = lid
              dataToCreate.lid = lid
            }
          } else {
            dataToUpdate.lid = null
            dataToCreate.lid = null
          }

          if (phoneNumber) {
            dataToUpdate.phoneNumber = phoneNumber
            dataToCreate.phoneNumber = phoneNumber
          }
          if (newNotify !== undefined) {
             dataToUpdate.notify = newNotify
             dataToCreate.notify = newNotify
          }
          if (newVerifiedName !== undefined) {
             dataToUpdate.verifiedName = newVerifiedName
             dataToCreate.verifiedName = newVerifiedName
          }
          if (newName !== undefined) {
            // Never overwrite a good existing 'name' with a transient upsert name
            if (!existing || !existing.name) {
              dataToUpdate.name = newName
            }
            dataToCreate.name = newName
          }

          // Always try to upsert to ensure the entry is created if it doesn't exist
          if (true) {
            // Clear conflicting LID from other records first
            if (dataToUpdate.lid) {
              await prisma.contact.updateMany({
                where: { lid: dataToUpdate.lid, id: { not: id } },
                data: { lid: null }
              })
            }

            await prisma.contact.upsert({
              where: { id },
              update: dataToUpdate,
              create: dataToCreate
            })

            // Proactive LID mapping check if not already provided
            if (!lid || !phoneNumber) {
              const mappingStore = (sock as any).signalRepository?.lidMapping
              if (mappingStore) {
                if (id.endsWith('@lid') && !phoneNumber) {
                  const pn = await mappingStore.getPNForLID(id)
                  if (pn) {
                    await prisma.contact.update({
                      where: { id },
                      data: { phoneNumber: pn }
                    })
                    console.log(`[LID Mapping] Proactively linked LID ${id} to PN ${pn}`)
                  }
                } else if (id.endsWith('@s.whatsapp.net') && !lid) {
                  const l = await mappingStore.getLIDForPN(id)
                  if (l) {
                    await prisma.contact.update({
                      where: { id },
                      data: { lid: l }
                    })
                    console.log(`[LID Mapping] Proactively linked PN ${id} to LID ${l}`)
                  }
                }
              }
            }

            // Cross-update logic
            const currentLid = lid || dataToUpdate.lid
            const currentPn = phoneNumber || dataToUpdate.phoneNumber

            if (id.includes('@s.whatsapp.net') && currentLid) {
              const existingByLid = await prisma.contact.findFirst({ where: { lid: currentLid } })
              if (existingByLid && existingByLid.id !== id) {
                await prisma.contact.update({
                  where: { id: existingByLid.id },
                  data: { phoneNumber: id, lid: null } // Ensure LID record doesn't claim its own LID in the unique column
                })
              }
            } else if (id.includes('@lid') && currentPn) {
              const existingByPn = await prisma.contact.findUnique({ where: { id: currentPn } })
              if (existingByPn) {
                await prisma.contact.update({
                  where: { id: existingByPn.id },
                  data: { lid: id }
                })
              }
            }
          }
        } catch (err) {
          console.error(`[Contacts] Error upserting contact ${id}:`, err)
        }
      }
    } catch (err) {
      console.error('[Contacts] Error in contacts.upsert handler:', err)
    }
  })

  // ── LID Mapping Update ──────────────────────────────────────────────
  sock.ev.on('lid-mapping.update', async (mappings) => {
    try {
      console.log(`[LID Mapping] Received ${mappings.length} updates`)
      for (const mapping of mappings) {
        const { lid, pn } = mapping
        if (!lid || !pn) continue

        console.log(`[LID Mapping] Linking ${lid} <-> ${pn}`)

        // Clear this LID from any other record to satisfy unique constraint
        await prisma.contact.updateMany({
          where: { lid, id: { not: pn } },
          data: { lid: null }
        })

        // Update the PN record with the LID
        await prisma.contact.upsert({
          where: { id: pn },
          update: { lid },
          create: { id: pn, lid }
        })

        // Update the LID record with the PN
        await prisma.contact.upsert({
          where: { id: lid },
          update: { phoneNumber: pn, lid: null },
          create: { id: lid, phoneNumber: pn, lid: null }
        })
      }
    } catch (err) {
      console.error('[LID Mapping] Error in lid-mapping.update handler:', err)
    }
  })


  // ── Chats Update (Phase 4) ────────────────────────────────────────
  sock.ev.on('chats.update', async (updates) => {
    for (const update of updates) {
      try {
        const jid = update.id as string | undefined
        if (!jid) continue

        const data: Record<string, unknown> = {}

        if (typeof update.unreadCount === 'number') {
          data.unreadCount = update.unreadCount
        }
        if (typeof (update as any).pinned === 'number') {
          data.pinned = (update as any).pinned
        }
        if ((update as any).muteExpiration !== undefined) {
          const mute = (update as any).muteExpiration
          data.muteExpiration = BigInt(typeof mute === 'number' ? mute : 0)
        }
        if ((update as any).archived !== undefined) {
          data.isArchived = (update as any).archived === true
        }

        // Removed the name/subject checks here so TypeScript and Prisma stay happy

        const ts = (update as any).conversationTimestamp ?? (update as any).timestamp
        if (ts) {
          data.timestamp = BigInt(
            typeof ts === 'object' && ts !== null && 'low' in ts ? ts.low : ts
          )
        }

        if (Object.keys(data).length > 0) {
          await prisma.chat.upsert({
            where: { jid },
            update: data as any,
            create: { jid, ...data } as any
          })

          // Notify renderer
          if (!window.isDestroyed()) {
            window.webContents.send('chat-updated', {
              jid,
              ...Object.fromEntries(
                Object.entries(data).map(([k, v]) =>
                  [k, typeof v === 'bigint' ? v.toString() : v]
                )
              )
            })
          }
        }
      } catch (err) {
        console.error('[chats.update] Error:', err)
      }
    }
  })

  // ── Chats Upsert (Phase 4) ────────────────────────────────────────
  sock.ev.on('chats.upsert', async (newChats) => {
    for (const chat of newChats) {
      try {
        const jid = chat.id as string | undefined
        if (!jid) continue

        const ts = (chat as any).conversationTimestamp ?? (chat as any).timestamp ?? 0
        const timestamp = BigInt(
          typeof ts === 'object' && ts !== null && 'low' in ts ? ts.low : ts
        )

        await prisma.chat.upsert({
          where: { jid },
          update: {
            unreadCount: typeof chat.unreadCount === 'number' ? chat.unreadCount : undefined,
            timestamp
            // Removed name from update
          },
          create: {
            jid,
            unreadCount: typeof chat.unreadCount === 'number' ? chat.unreadCount : 0,
            timestamp
            // Removed name from create
          }
        })

        if (!window.isDestroyed()) {
          window.webContents.send('chat-updated', {
            jid,
            unreadCount: typeof chat.unreadCount === 'number' ? chat.unreadCount : 0,
            timestamp: timestamp.toString()
          })
        }
      } catch (err) {
        console.error('[chats.upsert] Error:', err)
      }
    }
  })

  // ── Contacts Update (Phase 4) ─────────────────────────────────────
  sock.ev.on('contacts.update', async (updates) => {
    try {
      contactsUpdateCount++
      const debugDir = join(process.cwd(), 'debug')
      if (!fs.existsSync(debugDir)) fs.mkdirSync(debugDir, { recursive: true })
      const filePath = join(debugDir, `contacts_update_${contactsUpdateCount}.json`)
      fs.writeFileSync(filePath, JSON.stringify(updates, (_, value) =>
        typeof value === 'bigint' ? value.toString() : value
        , 2))

      for (const contact of updates) {
        try {
          const id = contact.id as string | undefined
          if (!id) continue

          const lid = (contact as any).lid as string | undefined
          const phoneNumber = (contact as any).phoneNumber as string | undefined
          const newName = (contact as any).name as string | undefined
          const newNotify = ((contact as any).notify ?? (contact as any).pushName) as string | undefined
          const newVerifiedName = (contact as any).verifiedName as string | undefined

          const dataToUpdate: any = {}
          const dataToCreate: any = { id }

          // Similar to upsert: only set lid mapping for PN records.
          if (id.endsWith('@s.whatsapp.net')) {
            if (lid) {
              dataToUpdate.lid = lid
              dataToCreate.lid = lid
            }
          } else {
            dataToUpdate.lid = null
            dataToCreate.lid = null
          }

          if (phoneNumber) {
            dataToUpdate.phoneNumber = phoneNumber
            dataToCreate.phoneNumber = phoneNumber
          }
          if (newNotify !== undefined) {
             dataToUpdate.notify = newNotify
             dataToCreate.notify = newNotify
          }
          if (newVerifiedName !== undefined) {
             dataToUpdate.verifiedName = newVerifiedName
             dataToCreate.verifiedName = newVerifiedName
          }
          if (newName !== undefined) {
            // contacts.update usually means explicit change, so always update
            dataToUpdate.name = newName
            dataToCreate.name = newName
          }

          // Always try to upsert to ensure the entry is created if it doesn't exist
          if (true) {
            await prisma.contact.upsert({
              where: { id },
              update: dataToUpdate,
              create: dataToCreate
            })
            console.log(`[contacts.update] Updated contact ${id}: ${JSON.stringify(dataToUpdate)}`)
          }
        } catch (err) {
          console.error('[contacts.update] Inner Error:', err)
        }
      }
    } catch (err) {
      console.error('[contacts.update] Outer Error:', err)
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
      // Once window is ready, start WA connection attempt
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

  protocol.handle('app', (request) => {
    const url = request.url.slice('app://'.length)
    if (url.startsWith('media/')) {
      const filePath = join(app.getPath('userData'), url)
      return net.fetch(pathToFileURL(filePath).href)
    }
    return new Response('Not Found', { status: 404 })
  })

  app.on('browser-window-created', (_, window) => {
    optimizer.watchWindowShortcuts(window)
  })

  ipcMain.on('ping', () => console.log('pong'))

  // Register Phase 03 IPC handlers
  registerIpcHandlers(prisma, getSock)

  // Let the renderer skip the remaining sync
  ipcMain.on('wa-skip-sync', () => {
    console.log('[HistorySync] Sync skipped by user')
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
