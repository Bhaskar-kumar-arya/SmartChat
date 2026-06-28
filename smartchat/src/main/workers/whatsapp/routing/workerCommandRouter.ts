import { parentPort } from 'worker_threads'
import type { WASocket, AnyMessageContent, MiscMessageGenerationOptions, ChatModification, proto } from '@whiskeysockets/baileys'
import { WorkerCommandMessage } from '../whatsappWorker.types'
import { WorkerConnectionManager } from '../socket/workerConnectionManager'
import { restoreBuffers } from '../utils/workerUtils'
import { PrismaClient } from '@prisma/client'

/**
 * WorkerCommandRouter
 * ===================
 * Routes commands sent from the main process thread to either the Baileys socket instance
 * or the bootstrapped services inside the worker thread.
 */
export class WorkerCommandRouter {
  constructor(
    private readonly connectionManager: WorkerConnectionManager,
    private readonly bootstrapPrismaAndRepos: (
      dbPath: string,
      userDataPath: string
    ) => Promise<{ prisma: PrismaClient; repos: any }>
  ) {}

  public async handleCommand(command: WorkerCommandMessage) {
    console.log(`[WhatsAppWorker] Received command: ${command.type}`)
    
    try {
      switch (command.type) {
        case 'init': {
          const { dbPath, userDataPath, syncFullHistory, shouldSyncHistory } = command.payload
          console.log(`[WhatsAppWorker] Initializing with dbPath: ${dbPath}, userDataPath: ${userDataPath}, syncFullHistory: ${syncFullHistory}, shouldSyncHistory: ${shouldSyncHistory}`)

          const { prisma, repos } = await this.bootstrapPrismaAndRepos(dbPath, userDataPath)

          this.connectionManager.setup(
            userDataPath,
            syncFullHistory,
            prisma,
            repos
          )

          await this.connectionManager.connect()

          parentPort?.postMessage({
            type: 'reply',
            correlationId: command.correlationId,
            payload: { result: { status: 'initialized' } }
          })
          break
        }

        case 'send_message': {
          const sock = this.getSocketOrThrow()
          const { jid, content, options } = command.payload
          const restoredContent = restoreBuffers(content)
          const restoredOptions = restoreBuffers(options)
          const result = await sock.sendMessage(
            jid,
            restoredContent as AnyMessageContent,
            restoredOptions as MiscMessageGenerationOptions
          )
          parentPort?.postMessage({
            type: 'reply',
            correlationId: command.correlationId,
            payload: { result }
          })
          break
        }

        case 'read_messages': {
          const sock = this.getSocketOrThrow()
          const { keys } = command.payload
          await sock.readMessages(keys as proto.IMessageKey[])
          parentPort?.postMessage({
            type: 'reply',
            correlationId: command.correlationId,
            payload: { result: { status: 'success' } }
          })
          break
        }

        case 'chat_modify': {
          const sock = this.getSocketOrThrow()
          const { jid, modification } = command.payload
          await sock.chatModify(modification as ChatModification, jid)
          parentPort?.postMessage({
            type: 'reply',
            correlationId: command.correlationId,
            payload: { result: { status: 'success' } }
          })
          break
        }

        case 'group_fetch_all': {
          const sock = this.getSocketOrThrow()
          const groups = await sock.groupFetchAllParticipating()
          parentPort?.postMessage({
            type: 'reply',
            correlationId: command.correlationId,
            payload: { result: { groups } }
          })
          break
        }

        case 'get_pn_for_lid': {
          const sock = this.getSocketOrThrow()
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
          const sock = this.getSocketOrThrow()
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
          const sock = this.getSocketOrThrow()
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
          const sock = this.getSocketOrThrow()
          await sock.logout()
          parentPort?.postMessage({
            type: 'reply',
            correlationId: command.correlationId,
            payload: { result: { status: 'success' } }
          })
          break
        }

        case 'skip_sync': {
          const sock = this.getSocketOrThrow()
          const repos = this.getReposOrThrow()
          await repos.historySyncManager.skipSync(sock)
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
  }

  private getSocketOrThrow(): WASocket {
    const sock = this.connectionManager.getSocket()
    if (!sock) {
      throw new Error('Socket not initialized')
    }
    return sock
  }

  private getReposOrThrow() {
    const repos = this.connectionManager.getRepos()
    if (!repos) {
      throw new Error('Repositories not initialized')
    }
    return repos
  }
}
