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
import { receiptService } from './ReceiptService'

export class WhatsAppConnectionManager {
  private currentSock: ReturnType<typeof makeWASocket> | null = null
  private reconnectTimeout: NodeJS.Timeout | null = null
  private syncTimeout: NodeJS.Timeout | null = null
  private isFreshLogin = false
  private isInitialSyncInProgress = false
  private mainWindow: BrowserWindow | null = null
  private currentFinishSync: (() => void) | null = null

  constructor() { }

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
      this.isFreshLogin = true
      await prisma.authState.deleteMany({
        where: { id: 'history_sync_completed' }
      }).catch(() => {})

      const orphanChats = await prisma.chat.count()
      if (orphanChats > 0) {
        console.log(`[Cleanup] No auth creds but found ${orphanChats} orphan chats — wiping stale data`)
        await prisma.reaction.deleteMany()
        await prisma.messageVector.deleteMany()
        await prisma.message.deleteMany()
        await prisma.chatMember.deleteMany()
        await prisma.chat.deleteMany()
        await prisma.community.deleteMany()
        await prisma.identityAlias.deleteMany()
        await prisma.identity.deleteMany()
      }
    }

    const { state, saveCreds } = await usePrismaAuthState()
    const { version, isLatest } = await fetchLatestBaileysVersion()
    console.log(`using WA v${version.join('.')}, isLatest: ${isLatest}`)

    if (this.isFreshLogin) {
      await prisma.authState.deleteMany({
        where: { id: 'history_sync_completed' }
      }).catch(() => {})
    }

    const syncCompletedRow = await prisma.authState.findUnique({
      where: { id: 'history_sync_completed' }
    }).catch(() => null)
    const isHistorySyncCompleted = syncCompletedRow?.data === 'true'

    const shouldSyncHistory = this.isFreshLogin || this.isInitialSyncInProgress || !isHistorySyncCompleted
    const syncFullHistory = false

    const groupCache = new NodeCache({ stdTTL: 5 * 60, useClones: false })

    const sock = makeWASocket({
      version,
      auth: state,
      printQRInTerminal: false,
      generateHighQualityLinkPreview: true,
      browser: Browsers.macOS('Desktop'),
      syncFullHistory,
      shouldSyncHistoryMessage: () => shouldSyncHistory,
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

    // creds.update must stay as a direct listener (saveCreds is a plain callback)
    sock.ev.on('creds.update', saveCreds)

    // ── History Sync state — declared here so ev.process() can close over them ──
    let syncChunkCount = 0
    let maxProgress = 0
    let syncComplete = false
    const finishSync = async () => {
      if (syncComplete) return
      syncComplete = true
      this.isInitialSyncInProgress = false
      if (this.syncTimeout) {
        clearTimeout(this.syncTimeout)
        this.syncTimeout = null
      }
      embeddingService.setPaused(false)
      console.log(`[HistorySync] Sync complete after ${syncChunkCount} chunks`)

      if (this.currentSock) {
        try {
          const groups = await this.currentSock.groupFetchAllParticipating()
          // Log the full group metadata shape for inspection
          // waEventLogger.log('groupFetchAllParticipating:result', Object.values(groups), { totalGroups: Object.keys(groups).length })
          const groupKeys = Object.keys(groups)
          const totalGroups = groupKeys.length
          let groupCount = 0

          this.mainWindow?.webContents.send('wa-sync-progress', 99)
          this.mainWindow?.webContents.send('wa-sync-status', 'Fetching group metadata from WhatsApp...')

          for (const jid of groupKeys) {
            if (++groupCount % 5 === 0) {
              await new Promise(r => setImmediate(r))
              this.mainWindow?.webContents.send('wa-sync-status', `Syncing group members... (${groupCount} / ${totalGroups})`)
            }
            const raw = groups[jid] as any
            await chatService.upsertChat(jid, raw).catch(() => { })
            if (raw.participants && raw.participants.length > 0) {
              await chatService.syncGroupMembers(jid, raw.participants).catch((err) => {
                console.error(`Failed to sync members for ${jid}:`, err)
              })
            }
          }
        } catch (err) {
          console.warn('[WhatsAppConnectionManager] Failed to sync community metadata:', err)
        }
      }

      // Heal any LID-stub / PN-identity splits that formed during the sync
      console.log('[finishSync] Running post-sync identity deduplication...')
      await contactService.deduplicateIdentities().catch((err) => {
        console.warn('[finishSync] deduplicateIdentities error:', err)
      })

      // Persist the completed history sync status in AuthState
      await prisma.authState.upsert({
        where: { id: 'history_sync_completed' },
        update: { data: 'true' },
        create: { id: 'history_sync_completed', data: 'true' }
      }).catch((err) => {
        console.error('Failed to save history sync complete status:', err)
      })

      if (this.mainWindow && !this.mainWindow.isDestroyed()) {
        this.mainWindow.webContents.send('wa-sync-progress', 100)
        this.mainWindow.webContents.send('wa-sync-complete')
      }
    }
    this.currentFinishSync = finishSync

    // All other events go through ev.process() — events fired in the same JS tick
    // are batched and processed sequentially, preventing race conditions between
    // e.g. messages.upsert and chats.update hitting the same row simultaneously.
    sock.ev.process(async (events) => {

      // ── Log every event batch to JSONL (logs/wa_events_<date>.jsonl) ─────
      // waEventLogger.logBatch(events as Record<string, unknown>)
      // ──────────────────────────────────────────────────────────────────────

      // ── Connection ────────────────────────────────────────────────────────
      if (events['connection.update']) {
        const update = events['connection.update']
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
              await prisma.reaction.deleteMany()
              await prisma.messageVector.deleteMany()
              await prisma.message.deleteMany()
              await prisma.chatMember.deleteMany()
              await prisma.chat.deleteMany()
              await prisma.community.deleteMany()
              await prisma.identityAlias.deleteMany()
              await prisma.identity.deleteMany()
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
          if (sock.user) {
            await contactService.registerMe(sock.user).catch((err) => {
              console.error('[Connection] Failed to register logged-in user identity:', err)
            })
          }
          if (this.mainWindow && !this.mainWindow.isDestroyed()) {
            if (!this.isFreshLogin && !this.isInitialSyncInProgress) {
              const syncCompletedRow = await prisma.authState.findUnique({
                where: { id: 'history_sync_completed' }
              }).catch(() => null)
              const isHistorySyncCompleted = syncCompletedRow?.data === 'true'

              if (isHistorySyncCompleted) {
                console.log(`[Connection] Reconnect: history sync previously completed, skipping sync`)
                embeddingService.setPaused(false)
                this.mainWindow.webContents.send('wa-sync-progress', 100)
                this.mainWindow.webContents.send('wa-sync-complete')
              } else {
                console.log(`[Connection] Reconnect: history sync NOT completed, continuing sync`)
                this.mainWindow.webContents.send('wa-connected')
              }
            } else {
              console.log('[Connection] Fresh login or active sync reconnect detected, showing/continuing sync screen')
              this.isInitialSyncInProgress = true
              this.isFreshLogin = false
              this.mainWindow.webContents.send('wa-connected')
            }
          }
        }
      }

      // ── History Sync ──────────────────────────────────────────────────────
      if (events['messaging-history.set']) {
        const data = events['messaging-history.set']
        try {
          embeddingService.setPaused(true)
          syncChunkCount++
          const rawData = data as Record<string, unknown>
          const reportedProgress = typeof rawData.progress === 'number' ? rawData.progress : undefined
          const syncType = typeof rawData.syncType === 'number' ? rawData.syncType : undefined

          if (this.syncTimeout) clearTimeout(this.syncTimeout)
          this.syncTimeout = setTimeout(finishSync, 180_000)

          await handleHistorySync(
            data as unknown as Parameters<typeof handleHistorySync>[0],
            prisma
          )

          if (this.mainWindow && !this.mainWindow.isDestroyed() && !syncComplete) {
            let calculatedProgress: number | undefined = undefined

            if (reportedProgress !== undefined) {
              if (syncType === 0) {
                // INITIAL_BOOTSTRAP: map to 0%
                calculatedProgress = 0
              } else if (syncType === 3) {
                // RECENT sync: map 0-100% to 0-30% (if full history enabled) or 0-100% (if full history disabled)
                const min = 0
                const max = syncFullHistory ? 30 : 100
                calculatedProgress = Math.round(min + (reportedProgress / 100) * (max - min))
              } else if (syncType === 2) {
                // FULL sync: map 0-100% to 30-100% (only if full history enabled)
                if (syncFullHistory) {
                  const min = 30
                  const max = 100
                  calculatedProgress = Math.round(min + (reportedProgress / 100) * (max - min))
                }
              }
            }

            if (calculatedProgress !== undefined) {
              maxProgress = Math.max(maxProgress, calculatedProgress)
              this.mainWindow.webContents.send('wa-sync-progress', maxProgress)
              if (maxProgress === 100) {
                finishSync()
              }
            }
          }
        } catch (err) {
          console.error('[HistorySync] Error processing sync payload:', err)
        }
      }

      // ── Messages Upsert ───────────────────────────────────────────────────
      if (events['messages.upsert']) {
        const { messages, type } = events['messages.upsert']

        // 'append' = backlog catch-up after reconnect. Fast bulk path.
        if (type === 'append') {
          try {
            await messageService.bulkPersistMessages(messages)
          } catch (err) {
            console.error('[messages.upsert:append] Bulk persist error:', err)
          }
        } else {
          // 'notify' = real-time new message. Full enrichment pipeline.
          for (const msg of messages) {
            try {
              const processed = await messageService.processMessage(msg, sock)
              if (!processed) continue

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
                      const nameMap = await contactService.batchResolveNames([dbMsg.participant || dbMsg.chatJid], sock)
                      const enriched = await messageService.enrichMessage(dbMsg, sock, nameMap)
                      this.mainWindow.webContents.send('message-edited', enriched)
                    }
                  }
                }
                continue
              }

              const { remoteJid, timestamp, messageType, participant } = processed

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
            } catch (err) {
              console.error('[messages.upsert:notify] Error processing message:', err)
            }
          }
        }
      }

      // ── Message Updates (revoke/edit/status via messages.update) ──────────
      if (events['messages.update']) {
        for (const update of events['messages.update']) {
          try {
            // Process status updates (e.g. server ack)
            if (update.update?.status !== undefined && update.key?.id) {
              await receiptService.processMessageStatusUpdate(
                update.key,
                update.update.status,
                this.mainWindow
              ).catch(() => {})
            }

            const protocol = update.update?.protocolMessage
            if (!protocol) continue
            const key = protocol.key
            if (!key?.id) continue

            switch (protocol.type) {
              case 0: // REVOKE
                console.log('[messages.update] Message revoked:', key.id)
                await prisma.message.update({
                  where: { id: key.id },
                  data: { isDeleted: true }
                }).catch(() => { })
                if (this.mainWindow && !this.mainWindow.isDestroyed()) {
                  this.mainWindow.webContents.send('message-deleted', {
                    id: key.id,
                    remoteJid: key.remoteJid,
                    fromMe: key.fromMe
                  })
                }
                break

              case 14: { // MESSAGE_EDIT
                console.log('[messages.update] Message edited:', key.id)
                const editedMsg = protocol.editedMessage
                if (editedMsg) {
                  const textContent = editedMsg.conversation || editedMsg.extendedTextMessage?.text
                    || editedMsg.imageMessage?.caption || editedMsg.videoMessage?.caption || null
                  await prisma.message.update({
                    where: { id: key.id },
                    data: { content: JSON.stringify(editedMsg), textContent, isEdited: true }
                  }).catch(() => { })
                  if (this.mainWindow && !this.mainWindow.isDestroyed()) {
                    const dbMsg = await prisma.message.findUnique({ where: { id: key.id } })
                    if (dbMsg) {
                      const nameMap = await contactService.batchResolveNames([dbMsg.participant || dbMsg.chatJid], sock)
                      const enriched = await messageService.enrichMessage(dbMsg, sock, nameMap)
                      this.mainWindow.webContents.send('message-edited', enriched)
                    }
                  }
                }
                break
              }
            }
          } catch (err) {
            console.error('[messages.update] Error processing update:', err)
          }
        }
      }

      // ── Contacts ──────────────────────────────────────────────────────────
      if (events['contacts.upsert']) {
        for (const contact of events['contacts.upsert']) {
          await contactService.upsertContact(contact).catch(() => { })
          // contacts.upsert frequently carries both id (PN) and lid on the same object
          // e.g. { id: "91xxx@s.whatsapp.net", name: "...", lid: "12345@lid" }
          const raw = contact as any
          if (raw.lid && raw.id && !String(raw.id).endsWith('@lid') && String(raw.id).includes('@s.whatsapp.net')) {
            await contactService.linkLidAndPn(String(raw.lid), String(raw.id), 'contacts.upsert').catch(() => { })
          }
        }
      }

      if (events['contacts.update']) {
        for (const contact of events['contacts.update']) {
          await contactService.upsertContact(contact, { overwriteName: true }).catch(() => { })
        }
      }

      if (events['lid-mapping.update']) {
        for (const mapping of events['lid-mapping.update']) {
          const { lid, pn } = mapping
          if (lid && pn) await contactService.linkLidAndPn(lid, pn, 'lid-mapping.update').catch(() => { })
        }
      }

      // ── Chats ─────────────────────────────────────────────────────────────
      if (events['chats.update']) {
        for (const update of events['chats.update']) {
          const jid = update.id
          if (jid) {
            await chatService.upsertChat(jid, update).catch(() => { })
            if (this.mainWindow && !this.mainWindow.isDestroyed()) {
              const formatted: any = {}
              for (const [key, val] of Object.entries(update)) {
                formatted[key] = typeof val === 'bigint' ? val.toString() : val
              }
              this.mainWindow.webContents.send('chat-updated', { jid, ...formatted })
            }
          }
        }
      }

      if (events['chats.upsert']) {
        for (const chat of events['chats.upsert']) {
          const jid = chat.id
          if (jid) {
            // @ts-ignore
            const raw = { ...chat, ...(chat.metadata || {}) }
            await chatService.upsertChat(jid, raw).catch(() => { })
          }
        }
      }

      // ── Groups ────────────────────────────────────────────────────────────
      if (events['groups.update']) {
        for (const update of events['groups.update']) {
          const raw = update as any
          if (!raw.id) continue

          // Always upsert the chat — groups.update carries subject, desc, owner,
          // ephemeralDuration, etc. that we want to store regardless of group type.
          await chatService.upsertChat(raw.id, raw).catch(() => { })

          // Sync participants when the event includes them (it often does on first
          // group metadata push). This is where phoneNumber → LID linking happens
          // for groups that weren't caught by groupFetchAllParticipating yet.
          if (raw.participants && raw.participants.length > 0) {
            await chatService.syncGroupMembers(raw.id, raw.participants).catch((err) => {
              console.error(`[groups.update] Failed to sync members for ${raw.id}:`, err)
            })
          }
        }
      }

      if (events['group-participants.update']) {
        const { id, participants, action } = events['group-participants.update']
        if (id && participants) {
          for (const jid of participants) {
            let identityId = await contactService.getIdentityIdByJid(jid)
            if (!identityId) {
              await contactService.upsertContact({ id: jid }).catch(() => { })
              identityId = await contactService.getIdentityIdByJid(jid)
            }
            if (identityId) {
              if (action === 'add' || action === 'promote' || action === 'demote') {
                const role = action === 'promote' ? 'ADMIN' : 'MEMBER'
                await prisma.chatMember.upsert({
                  where: { chatJid_identityId: { chatJid: id, identityId } },
                  update: { role },
                  create: { chatJid: id, identityId, role }
                }).catch(() => { })
              } else if (action === 'remove') {
                await prisma.chatMember.delete({
                  where: { chatJid_identityId: { chatJid: id, identityId } }
                }).catch(() => { })
              }
            }
          }
        }
      }

      // ── Message Reactions (messages.reaction) ─────────────────────────────
      if (events['messages.reaction']) {
        for (const reactionUpdate of events['messages.reaction']) {
          await messageService.processReaction(reactionUpdate, sock, this.mainWindow).catch((err) => {
            console.error('[WhatsAppConnectionManager] Error processing messages.reaction:', err)
          })
        }
      }

      // ── Presence ──────────────────────────────────────────────────────────
      if (events['presence.update']) {
        const { id, presences } = events['presence.update']
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
      }

      // ── Message Receipts (read/delivered ticks) ───────────────────────────
      if (events['message-receipt.update']) {
        for (const update of events['message-receipt.update']) {
          const { key, receipt } = update as any
          const type = receipt?.readTimestamp
            ? 'read'
            : receipt?.deliveredTimestamp
            ? 'delivered'
            : 'unknown'
          console.log(
            `[message-receipt.update] ${type} | msgId=${key?.id} | chat=${key?.remoteJid} | by=${receipt?.userJid} | ts=${receipt?.readTimestamp ?? receipt?.deliveredTimestamp}`
          )
          await receiptService.processMessageReceipt(update, sock, this.mainWindow).catch(() => {})
        }
      }

      // ── Call Events ───────────────────────────────────────────────────────
      if (events['call']) {
        for (const call of events['call']) {
          try {
            const rawCall = call as any
            const fromJid = rawCall.from
            const altPn = rawCall.callerPn || rawCall.content?.attrs?.['caller_pn'] || rawCall.attrs?.['caller_pn']
            const altLid = rawCall.content?.attrs?.['caller_lid'] || rawCall.attrs?.['caller_lid']
            
            const ids = [fromJid, altPn, altLid].filter(Boolean) as string[];
            let callLid: string | null = null;
            let callPn: string | null = null;
            
            for (const id of ids) {
               if (typeof id === 'string') {
                 if (id.includes('@lid')) callLid = id;
                 if (id.includes('@s.whatsapp.net')) callPn = id;
               }
            }

            if (callLid && callPn) {
              await contactService.linkLidAndPn(callLid, callPn, 'call.event').catch(() => {})
            }
          } catch (err) {
            console.error('[WhatsAppConnectionManager] Error processing call event:', err)
          }
        }
      }

    }) // end sock.ev.process
  }

  public skipSync() {
    if (this.currentFinishSync) {
      this.currentFinishSync()
    }
  }
}

export const waConnectionManager = new WhatsAppConnectionManager()
