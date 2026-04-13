import { BrowserWindow } from 'electron'
import baileys, { DisconnectReason, fetchLatestBaileysVersion, Browsers } from '@whiskeysockets/baileys'
const makeWASocket = (baileys as any).default || baileys;
import { Boom } from '@hapi/boom'
import NodeCache from 'node-cache'
import { prisma, usePrismaAuthState } from '../auth'
import { handleHistorySync } from '../historySync'
import { contactService } from './ContactService'
import { messageService } from './MessageService'
import { chatService } from './ChatService'
import { embeddingService } from './EmbeddingService'

export class WhatsAppConnectionManager {
  private currentSock: ReturnType<typeof makeWASocket> | null = null
  private reconnectTimeout: NodeJS.Timeout | null = null
  private syncTimeout: NodeJS.Timeout | null = null
  private isFreshLogin = false
  private mainWindow: BrowserWindow | null = null
  private currentFinishSync: (() => void) | null = null

  constructor() {}

  public setWindow(window: BrowserWindow) {
    this.mainWindow = window
  }

  public getSocket(): ReturnType<typeof makeWASocket> | null {
    return this.currentSock
  }

  public async connect() {
    embeddingService.setPaused(false) // Clean start
    if (!this.mainWindow) {
      console.warn('[WhatsAppConnectionManager] No window set, cannot connect.')
      return
    }

    // Clear any existing reconnect timeout
    if (this.reconnectTimeout) {
      clearTimeout(this.reconnectTimeout)
      this.reconnectTimeout = null
    }

    // Gracefully shut down existing socket
    if (this.currentSock) {
      console.log('[Connection] Cleaning up previous socket instance before reconnecting...')
      try {
        this.currentSock.ev.removeAllListeners()
        this.currentSock.end(new Error('Replaced by new socket instance'))
      } catch (err) {
        console.warn('[Connection] Error cleaning up old socket:', err)
      }
      this.currentSock = null
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

    this.currentSock = sock

    // Watch for auth state changes
    sock.ev.on('creds.update', saveCreds)

    // Watch for connection updates
    sock.ev.on('connection.update', async (update) => {
      const { connection, lastDisconnect, qr } = update

      if (qr) {
        console.log('Got QR string:', qr)
        this.isFreshLogin = true
        if (this.mainWindow && !this.mainWindow.isDestroyed()) {
          this.mainWindow.webContents.send('wa-qr', qr)
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
          const delay = isRestartRequired ? 500 : 3000
          console.log(`[Connection] Scheduling reconnect in ${delay}ms...`)
          this.reconnectTimeout = setTimeout(() => this.connect(), delay)
        } else if (isConflict) {
          console.warn('[Connection] Replaced by another session (440 conflict). Standing down.')
        } else {
          console.log('Logged out — wiping all data for fresh QR...')
          try {
            await prisma.message.deleteMany()
            await prisma.chat.deleteMany()
            await prisma.contact.deleteMany()
            await prisma.authState.deleteMany()
          } catch (err) {
            console.error('Error wiping data:', err)
          }
          this.isFreshLogin = true
          if (this.mainWindow && !this.mainWindow.isDestroyed()) {
            this.mainWindow.webContents.send('wa-logged-out')
          }
          this.connect()
        }
      } else if (connection === 'open') {
        console.log('Connected to WhatsApp!')
        if (this.mainWindow && !this.mainWindow.isDestroyed()) {
          if (!this.isFreshLogin) {
            const chatCount = await prisma.chat.count()
            if (chatCount > 0) {
              console.log(`[Connection] Reconnect: found ${chatCount} existing chats, skipping sync`)
              embeddingService.setPaused(false)
              this.mainWindow.webContents.send('wa-sync-progress', 100)
              this.mainWindow.webContents.send('wa-sync-complete')
            } else {
              this.mainWindow.webContents.send('wa-connected')
            }
          } else {
            console.log('[Connection] Fresh login detected, showing sync screen')
            this.isFreshLogin = false
            this.mainWindow.webContents.send('wa-connected')
          }
        }
      }
    })

    // History Sync
    let syncChunkCount = 0
    let maxProgress = 0
    let syncComplete = false
    const finishSync = async () => {
      if (syncComplete) return
      syncComplete = true
      embeddingService.setPaused(false)
      console.log(`[HistorySync] Sync complete after ${syncChunkCount} chunks`)

      if (this.currentSock) {
        try {
          const groups = await this.currentSock.groupFetchAllParticipating()
          
          // Persist the freshly fetched metadata to the DB
          for (const jid in groups) {
            const raw = groups[jid] as any
            const isComm = raw.isCommunity || raw.isParentGroup
            const isAnn = raw.isAnnounce || raw.isCommunityAnnounce || raw.isDefaultSubgroup
            const parent = raw.linkedParentJid || raw.linkedParent || raw.parentGroupId

            if (isComm || isAnn || parent) {
              await chatService.upsertChat(jid, raw).catch(() => {})
            }
          }
        } catch (err) {
          console.warn('[WhatsAppConnectionManager] Failed to sync community metadata:', err)
        }
      }

      if (this.mainWindow && !this.mainWindow.isDestroyed()) {
        this.mainWindow.webContents.send('wa-sync-progress', 100)
        this.mainWindow.webContents.send('wa-sync-complete')
      }
    }
    this.currentFinishSync = finishSync

    sock.ev.on('messaging-history.set', async (data) => {
      try {
        embeddingService.setPaused(true)
        syncChunkCount++
        const rawData = data as Record<string, unknown>
        const reportedProgress = typeof rawData.progress === 'number' ? rawData.progress : undefined
        
        if (this.syncTimeout) clearTimeout(this.syncTimeout)
        this.syncTimeout = setTimeout(finishSync, 180_000)

        await handleHistorySync(
          data as unknown as Parameters<typeof handleHistorySync>[0],
          prisma
        )

        if (this.mainWindow && !this.mainWindow.isDestroyed() && !syncComplete) {
          const estimated = reportedProgress ?? Math.min(syncChunkCount * 15, 95)
          maxProgress = Math.max(maxProgress, estimated)
          this.mainWindow.webContents.send('wa-sync-progress', maxProgress)
        }
      } catch (err) {
        console.error('[HistorySync] Error processing sync payload:', err)
      }
    })

    // Real-Time Messages
    sock.ev.on('messages.upsert', async (upsert) => {
      const { messages, type } = upsert

      for (const msg of messages) {
        try {
          const processed = await messageService.processMessage(msg, sock)
          if (!processed) continue

          // Handle protocol message updates (Revoke/Edit) that don't result in new messages
          if (processed.type === 'protocol') {
            if (processed.subType === 'revoke') {
              if (this.mainWindow && !this.mainWindow.isDestroyed()) {
                this.mainWindow.webContents.send('message-deleted', { 
                  id: processed.targetId, 
                  remoteJid: processed.key.remoteJid,
                  fromMe: processed.key.fromMe 
                })
              }
            } else if (processed.subType === 'edit') {
              if (this.mainWindow && !this.mainWindow.isDestroyed()) {
                const dbMsg = await prisma.message.findUnique({ where: { id: processed.targetId } })
                if (dbMsg) {
                  const nameMap = await contactService.batchResolveNames([dbMsg.participant || dbMsg.remoteJid], sock)
                  const enriched = await messageService.enrichMessage(dbMsg, sock, nameMap)
                  this.mainWindow.webContents.send('message-edited', enriched)
                }
              }
            }
            continue
          }

          const { remoteJid, timestamp, messageType, participant } = processed

          if (type === 'notify') {
            if (!processed.fromMe) {
              if (messageType !== 'reactionMessage') {
                await chatService.incrementUnread(remoteJid, timestamp)
              }
            } else if (messageType !== 'reactionMessage') {
              await chatService.updateTimestamp(remoteJid, timestamp)
            }

            if (this.mainWindow && !this.mainWindow.isDestroyed()) {
              const jids = new Set<string>([participant || remoteJid])
              const nameMap = await contactService.batchResolveNames(Array.from(jids), sock)
              const enriched = await messageService.enrichMessage(processed, sock, nameMap)
              this.mainWindow.webContents.send('new-message', enriched)
            }
          } else {
            await chatService.updateTimestamp(remoteJid, timestamp)
          }
        } catch (err) {
          console.error('[messages.upsert] Error processing message:', err)
        }
      }
    })

    // Handle Message Edits and Revokes
    sock.ev.on('messages.update', async (updates) => {
      for (const update of updates) {
        const protocol = update.update?.protocolMessage
        if (!protocol) continue

        const key = protocol.key
        if (!key?.id) continue

        try {
          switch (protocol.type) {
            case 0: // REVOKE
              console.log('[messages.update] Message revoked:', key.id)
              await prisma.message.update({
                where: { id: key.id },
                data: { isDeleted: true }
              }).catch(() => {})
              
              if (this.mainWindow && !this.mainWindow.isDestroyed()) {
                this.mainWindow.webContents.send('message-deleted', { 
                  id: key.id, 
                  remoteJid: key.remoteJid,
                  fromMe: key.fromMe 
                })
              }
              break

            case 14: // MESSAGE_EDIT
              console.log('[messages.update] Message edited:', key.id)
              const editedMsg = protocol.editedMessage
              if (editedMsg) {
                const textContent = editedMsg.conversation || editedMsg.extendedTextMessage?.text || (editedMsg.imageMessage?.caption) || (editedMsg.videoMessage?.caption) || null
                
                await prisma.message.update({
                  where: { id: key.id },
                  data: { 
                    content: JSON.stringify(editedMsg), 
                    textContent,
                    isEdited: true 
                  }
                }).catch(() => {})

                if (this.mainWindow && !this.mainWindow.isDestroyed()) {
                  const dbMsg = await prisma.message.findUnique({ where: { id: key.id } })
                  if (dbMsg) {
                    const nameMap = await contactService.batchResolveNames([dbMsg.participant || dbMsg.remoteJid], sock)
                    const enriched = await messageService.enrichMessage(dbMsg, sock, nameMap)
                    this.mainWindow.webContents.send('message-edited', enriched)
                  }
                }
              }
              break
          }
        } catch (err) {
          console.error('[messages.update] Error processing update:', err)
        }
      }
    })

    // Contacts Events
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

    // Chats Events
    sock.ev.on('chats.update', async (updates) => {
      for (const update of updates) {
        const jid = update.id
        if (jid) {
          await chatService.upsertChat(jid, update).catch(() => {})
          if (this.mainWindow && !this.mainWindow.isDestroyed()) {
            const formatted: any = {}
            for (const [key, val] of Object.entries(update)) {
              formatted[key] = typeof val === 'bigint' ? val.toString() : val
            }
            this.mainWindow.webContents.send('chat-updated', { jid, ...formatted })
          }
        }
      }
    })

    sock.ev.on('chats.upsert', async (newChats) => {
      for (const chat of newChats) {
        const jid = chat.id
        if (jid) {
          // Flatten metadata for consistent detection
          // @ts-ignore
          const raw = { ...chat, ...(chat.metadata || {}) }

          // Use the flattened raw object to ensure upsertChat catches all fields
          await chatService.upsertChat(jid, raw).catch(() => {})
        }
      }
    })


    // Persist Group Updates (Real-time membership/links)
    sock.ev.on('groups.update', async (updates) => {
      for (const update of updates) {
        const raw = update as any
        const isComm = raw.isCommunity || raw.isParentGroup
        const isAnnounce = raw.isCommunityAnnounce || raw.isDefaultSubgroup
        const parent = raw.linkedParentJid || raw.linkedParent || raw.parentGroupId

        if (isComm || isAnnounce || parent) {
          // Persist this change to the database!
          await chatService.upsertChat(update.id!, raw).catch(() => {})
        }
      }
    })



    // Presence Update
    sock.ev.on('presence.update', async (update) => {
      const { id, presences } = update
      
      if (this.mainWindow && !this.mainWindow.isDestroyed()) {
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

        this.mainWindow.webContents.send('presence-update', {
          remoteJid: id,
          presences: Object.fromEntries(enrichedPresences)
        })
      }
    })
  }

  public skipSync() {
    if (this.currentFinishSync) {
      this.currentFinishSync()
    }
  }
}

export const waConnectionManager = new WhatsAppConnectionManager()
