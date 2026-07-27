import { IKernelModule } from './IKernelModule'
import { IPermissionStore } from '../permissions/IPermissionStore'
import { IMessageQueryService } from '../../services/messages/IMessageQueryService'
import { IMessageActionService, IMessageActionSocket } from '../../services/messages/IMessageActionService'
import { IMediaService } from '../../services/messages/IMediaService'

export class KernelMessagesModule implements IKernelModule {
  readonly namespace = 'kernel:messages'

  constructor(
    private readonly permissions: IPermissionStore,
    private readonly messageQueryService: IMessageQueryService,
    private readonly messageActionService: IMessageActionService,
    private readonly getSock?: () => IMessageActionSocket | null,
    private readonly mediaService?: IMediaService
  ) {}

  async handle(pluginId: string, type: string, payload: unknown): Promise<unknown> {
    const action = this.extractAction(type)

    switch (action) {
      case 'getMessages': {
        const { jid, page = 1, limit = 50 } = payload as { jid: string; page?: number; limit?: number }
        this.requireCapability(pluginId, 'messages:read')
        this.requireResourceScope(pluginId, 'messages:read', jid)
        const messages = await this.messageQueryService.getChatMessages(jid, page, limit)
        return this.serialize(messages)
      }

      case 'send': {
        const { jid, text, options, quotedMsgId, mentions } = payload as {
          jid: string
          text: string
          options?: { quotedMsgId?: string; mentions?: string[] }
          quotedMsgId?: string
          mentions?: string[]
        }
        this.requireCapability(pluginId, 'messages:send')
        this.requireResourceScope(pluginId, 'messages:send', jid)
        const sock = this.getSocketOrThrow()
        const qMsgId = options?.quotedMsgId || quotedMsgId
        const mList = options?.mentions || mentions
        const msg = await this.messageActionService.sendMessageWorkflow(sock, jid, text, qMsgId, mList)
        return this.serialize(msg)
      }

      case 'delete': {
        const { jid, messageId } = payload as { jid: string; messageId: string }
        this.requireCapability(pluginId, 'messages:delete')
        this.requireResourceScope(pluginId, 'messages:delete', jid)
        const sock = this.getSocketOrThrow()
        return await this.messageActionService.deleteMessage(sock, messageId, jid)
      }

      case 'react': {
        const { jid, messageId, emoji, reaction } = payload as {
          jid: string
          messageId: string
          emoji?: string
          reaction?: string
        }
        this.requireCapability(pluginId, 'messages:send')
        this.requireResourceScope(pluginId, 'messages:send', jid)
        const sock = this.getSocketOrThrow()
        const targetReaction = emoji || reaction || ''
        return await this.messageActionService.reactToMessage(sock, messageId, targetReaction, jid)
      }

      case 'downloadMedia': {
        const { messageId } = payload as { messageId: string }
        this.requireCapability(pluginId, 'messages:read')
        const sock = this.getSocketOrThrow()
        if (!this.mediaService) {
          throw {
            code: 'INTERNAL_ERROR',
            message: 'MediaService is not available in KernelMessagesModule'
          }
        }
        const enriched = await this.mediaService.downloadAndCacheMedia(messageId, sock)
        let rawMsg: Record<string, any> = {}
        try {
          rawMsg = typeof enriched.content === 'string' ? JSON.parse(enriched.content) : (enriched.content || {})
        } catch (e) {}

        const localURI = rawMsg?.audioMessage?.localURI ||
          rawMsg?.imageMessage?.localURI ||
          rawMsg?.videoMessage?.localURI ||
          rawMsg?.documentMessage?.localURI ||
          rawMsg?.ptvMessage?.localURI ||
          rawMsg?.stickerMessage?.localURI

        let filePath: string | null = null
        if (localURI && typeof localURI === 'string') {
          const fileName = localURI.replace(/^app:\/\/media\//, '').replace(/^app:\/\//, '')
          try {
            const { app } = require('electron')
            const { join } = require('path')
            if (app) {
              filePath = join(app.getPath('userData'), 'media', fileName)
            }
          } catch (e) {}
        }

        return this.serialize({ success: true, localURI, filePath, message: enriched })
      }

      default:
        throw {
          code: 'NOT_FOUND',
          message: `Unknown action '${type}' in module '${this.namespace}'`
        }
    }
  }

  private extractAction(type: string): string {
    const parts = type.split(':')
    return parts.length > 2 ? parts.slice(2).join(':') : parts[1] || type
  }

  private requireCapability(pluginId: string, capability: string): void {
    if (!this.permissions.hasCapability(pluginId, capability)) {
      throw {
        code: 'PERMISSION_DENIED',
        message: `Plugin '${pluginId}' lacks capability '${capability}'`,
        permission: capability
      }
    }
  }

  private requireResourceScope(pluginId: string, capability: string, resourceId: string): void {
    if (!this.permissions.isResourceAllowed(pluginId, capability, resourceId)) {
      throw {
        code: 'PERMISSION_DENIED',
        message: `Plugin '${pluginId}' is denied access to resource '${resourceId}' for capability '${capability}'`,
        permission: capability
      }
    }
  }

  private getSocketOrThrow(): IMessageActionSocket {
    const sock = this.getSock?.()
    if (!sock) {
      throw {
        code: 'INTERNAL_ERROR',
        message: 'WhatsApp connection socket is not available'
      }
    }
    return sock
  }

  private serialize<T>(data: T): T {
    if (data === undefined || data === null) return data
    return JSON.parse(
      JSON.stringify(data, (_key, value) =>
        typeof value === 'bigint' ? value.toString() : value
      )
    )
  }
}
