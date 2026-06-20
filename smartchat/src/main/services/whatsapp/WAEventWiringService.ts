import { WASocket } from './types'
import { WAEventHandler } from './WAEventHandler'
import { IHistorySyncManager } from './IHistorySyncManager'
import { IWAEventWiringService, ConnectionCallbacks } from './IWAEventWiringService'

export class WAEventWiringService implements IWAEventWiringService {
  constructor(
    private readonly historySyncManager: IHistorySyncManager
  ) {}

  /**
   * Wires WhatsApp socket events to the respective handlers and event bus.
   */
  public wire(
    sock: WASocket,
    eventHandler: WAEventHandler,
    connectionCallbacks: ConnectionCallbacks,
    saveCreds: () => Promise<void>,
    syncFullHistory: boolean
  ): void {
    // Prevent MaxListenersExceededWarning
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
      console.warn('[WAEventWiringService] Failed to set max listeners:', err)
    }

    // creds.update must stay as a direct listener
    sock.ev.on('creds.update', saveCreds)

    // All other events go through ev.process()
    sock.ev.process(async (events) => {
      // ── Connection ────────────────────────────────────────────────────────
      if (events['connection.update']) {
        const update = events['connection.update']
        const { connection, lastDisconnect, qr } = update

        if (qr) {
          connectionCallbacks.handleQr(qr)
        }

        if (connection === 'close') {
          await connectionCallbacks.handleConnectionClose(lastDisconnect)
        } else if (connection === 'open') {
          await connectionCallbacks.handleConnectionOpen(sock, syncFullHistory)
        }

        await connectionCallbacks.handleConnectionUpdate(update)
      }

      // ── History Sync ──────────────────────────────────────────────────────
      if (events['messaging-history.set']) {
        const data = events['messaging-history.set']
        await this.historySyncManager.handleSyncChunk(data, syncFullHistory, sock)
      }

      // ── Messages Upsert ───────────────────────────────────────────────────
      if (events['messages.upsert']) {
        await eventHandler.handleMessagesUpsert(events['messages.upsert'], sock)
      }

      // ── Message Updates (revoke/edit/status via messages.update) ──────────
      if (events['messages.update']) {
        await eventHandler.handleMessagesUpdate(events['messages.update'], sock)
      }

      // ── Contacts ──────────────────────────────────────────────────────────
      if (events['contacts.upsert']) {
        await eventHandler.handleContactsUpsert(events['contacts.upsert'])
      }

      if (events['contacts.update']) {
        await eventHandler.handleContactsUpdate(events['contacts.update'])
      }

      if (events['lid-mapping.update']) {
        await eventHandler.handleLidMappingUpdate(events['lid-mapping.update'])
      }

      // ── Chats ─────────────────────────────────────────────────────────────
      if (events['chats.update']) {
        await eventHandler.handleChatsUpdate(events['chats.update'])
      }

      if (events['chats.upsert']) {
        await eventHandler.handleChatsUpsert(events['chats.upsert'])
      }

      // ── Groups ────────────────────────────────────────────────────────────
      if (events['groups.update']) {
        await eventHandler.handleGroupsUpdate(events['groups.update'])
      }

      if (events['group-participants.update']) {
        await eventHandler.handleGroupParticipantsUpdate(events['group-participants.update'])
      }

      // ── Message Reactions (messages.reaction) ─────────────────────────────
      if (events['messages.reaction']) {
        await eventHandler.handleMessagesReaction(events['messages.reaction'], sock)
      }

      // ── Presence ──────────────────────────────────────────────────────────
      if (events['presence.update']) {
        const data = events['presence.update']
        await eventHandler.handlePresenceUpdate(data, sock)
      }

      // ── Message Receipts (read/delivered ticks) ───────────────────────────
      if (events['message-receipt.update']) {
        await eventHandler.handleMessageReceiptUpdate(events['message-receipt.update'], sock)
      }

      // ── Call Events ───────────────────────────────────────────────────────
      if (events['call']) {
        await eventHandler.handleCallEvent(events['call'])
      }

      // ── App State Sync ────────────────────────────────────────────────────
      if (events['app-state.sync']) {
        const syncEvent = events['app-state.sync']
        const syncEvents = Array.isArray(syncEvent) ? (syncEvent as unknown[]) : [syncEvent]
        await eventHandler.handleAppStateSync(syncEvents, sock)
      }
    })
  }
}
