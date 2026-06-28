import type { WASocket } from '@whiskeysockets/baileys'
import { IWorkerBootstrap } from '../IWorkerBootstrap'
import { WorkerConnectionHandler } from '../socket/workerConnectionHandler'

/**
 * WorkerEventDispatcher
 * =====================
 * Plugs into the `sock.ev.process` stream and forwards event payloads (e.g. `messages.upsert`, `chats.update`)
 * to their respective database write pipelines inside the repositories helper.
 */
export class WorkerEventDispatcher {
  constructor(
    private readonly reposGetter: () => IWorkerBootstrap | null,
    private readonly connectionHandler: WorkerConnectionHandler,
    private readonly getSyncFullHistory: () => boolean
  ) {}

  public register(sock: WASocket) {
    sock.ev.process(async (events) => {
      const repos = this.reposGetter()
      if (!repos) return

      if (events['connection.update']) {
        await this.connectionHandler.handleConnectionUpdate(events['connection.update'])
      }

      if (events['messaging-history.set']) {
        const data = events['messaging-history.set']
        await repos.historySyncManager.handleSyncChunk(data, this.getSyncFullHistory(), sock)
      }

      if (events['messages.upsert']) {
        await repos.eventHandler.handleMessagesUpsert(events['messages.upsert'], sock)
      }

      if (events['messages.update']) {
        await repos.eventHandler.handleMessagesUpdate(events['messages.update'], sock)
      }

      if (events['contacts.upsert']) {
        await repos.eventHandler.handleContactsUpsert(events['contacts.upsert'])
      }

      if (events['contacts.update']) {
        await repos.eventHandler.handleContactsUpdate(events['contacts.update'])
      }

      if (events['lid-mapping.update']) {
        await repos.eventHandler.handleLidMappingUpdate(events['lid-mapping.update'])
      }

      if (events['chats.update']) {
        await repos.eventHandler.handleChatsUpdate(events['chats.update'])
      }

      if (events['chats.upsert']) {
        await repos.eventHandler.handleChatsUpsert(events['chats.upsert'])
      }

      if (events['groups.update']) {
        await repos.eventHandler.handleGroupsUpdate(events['groups.update'])
      }

      if (events['group-participants.update']) {
        await repos.eventHandler.handleGroupParticipantsUpdate(events['group-participants.update'])
      }

      if (events['messages.reaction']) {
        await repos.eventHandler.handleMessagesReaction(events['messages.reaction'], sock)
      }

      if (events['presence.update']) {
        await repos.eventHandler.handlePresenceUpdate(events['presence.update'], sock)
      }

      if (events['message-receipt.update']) {
        await repos.eventHandler.handleMessageReceiptUpdate(events['message-receipt.update'], sock)
      }

      if (events['call']) {
        await repos.eventHandler.handleCallEvent(events['call'])
      }

      if (events['app-state.sync']) {
        const syncEvent = events['app-state.sync']
        const syncEvents = Array.isArray(syncEvent) ? (syncEvent as unknown[]) : [syncEvent]
        await repos.eventHandler.handleAppStateSync(syncEvents, sock)
      }
    })
  }
}
