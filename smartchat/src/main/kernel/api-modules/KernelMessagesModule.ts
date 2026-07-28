import { join } from 'path'
import { BaseKernelModule } from './BaseKernelModule'
import { IPermissionStore } from '../permissions/IPermissionStore'
import { IMessageQueryService } from '../../services/messages/IMessageQueryService'
import { IMessageActionService, IMessageActionSocket } from '../../services/messages/IMessageActionService'
import { IMediaService } from '../../services/messages/IMediaService'
import { IReceiptService } from '../../services/whatsapp/IReceiptService'
import { IFavoriteStickerService } from '../../services/messages/IFavoriteStickerService'
import { KernelError, KernelNotFoundError } from './KernelErrors'

export class KernelMessagesModule extends BaseKernelModule {
  readonly namespace = 'kernel:messages'

  constructor(
    permissions: IPermissionStore,
    private readonly messageQueryService: IMessageQueryService,
    private readonly messageActionService: IMessageActionService,
    private readonly getSock?: () => IMessageActionSocket | null,
    private readonly mediaService?: IMediaService,
    private readonly getUserDataPath?: () => string,
    private readonly receiptService?: IReceiptService,
    private readonly favoriteStickerService?: IFavoriteStickerService
  ) {
    super(permissions)
  }

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

      case 'getMessagesAroundId': {
        const { jid, messageId, lookBehind = 20 } = payload as { jid: string; messageId: string; lookBehind?: number }
        this.requireCapability(pluginId, 'messages:read')
        this.requireResourceScope(pluginId, 'messages:read', jid)
        const messages = await this.messageQueryService.getMessagesAroundId(jid, messageId, lookBehind)
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

      case 'sendMedia': {
        const { jid, filePath, caption, options, quotedMsgId, mentions } = payload as {
          jid: string
          filePath: string
          caption?: string
          options?: { quotedMsgId?: string; mentions?: string[] }
          quotedMsgId?: string
          mentions?: string[]
        }
        this.requireCapability(pluginId, 'messages:send')
        this.requireResourceScope(pluginId, 'messages:send', jid)
        const sock = this.getSocketOrThrow()
        const qMsgId = options?.quotedMsgId || quotedMsgId
        const mList = options?.mentions || mentions
        const msg = await this.messageActionService.sendMediaMessageWorkflow(
          sock,
          jid,
          filePath,
          caption,
          qMsgId,
          mList
        )
        return this.serialize(msg)
      }

      case 'edit': {
        const { messageId, newText, jid } = payload as { messageId: string; newText: string; jid?: string }
        this.requireCapability(pluginId, 'messages:send')
        if (jid) {
          this.requireResourceScope(pluginId, 'messages:send', jid)
        }
        const sock = this.getSocketOrThrow()
        const msg = await this.messageActionService.editMessage(sock, messageId, newText, jid)
        return this.serialize(msg)
      }

      case 'forward': {
        const { messageId, targetJids, jid } = payload as { messageId: string; targetJids: string[]; jid?: string }
        this.requireCapability(pluginId, 'messages:send')
        if (jid) {
          this.requireResourceScope(pluginId, 'messages:send', jid)
        }
        const sock = this.getSocketOrThrow()
        return await this.messageActionService.forwardMessage(sock, messageId, targetJids, jid)
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
          throw new KernelError('INTERNAL_ERROR', 'MediaService is not available in KernelMessagesModule')
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
          const userDataPath = this.getUserDataPath?.()
          if (userDataPath) {
            filePath = join(userDataPath, 'media', fileName)
          }
        }

        return this.serialize({ success: true, localURI, filePath, message: enriched })
      }

      case 'getReceipts': {
        const { messageId } = payload as { messageId: string }
        this.requireCapability(pluginId, 'messages:read')
        if (!this.receiptService) {
          throw new KernelError('INTERNAL_ERROR', 'ReceiptService is not available in KernelMessagesModule')
        }
        const receipts = await this.receiptService.getMessageReceipts(messageId, null)
        return this.serialize(receipts)
      }

      case 'addFavoriteSticker': {
        const { messageId } = payload as { messageId: string }
        this.requireCapability(pluginId, 'messages:write')
        if (!this.favoriteStickerService) {
          throw new KernelError('INTERNAL_ERROR', 'FavoriteStickerService is not available in KernelMessagesModule')
        }
        const success = await this.favoriteStickerService.addStickerToFavorites(messageId)
        return { success }
      }

      case 'getFavoriteStickers': {
        this.requireCapability(pluginId, 'messages:read')
        if (!this.favoriteStickerService) {
          throw new KernelError('INTERNAL_ERROR', 'FavoriteStickerService is not available in KernelMessagesModule')
        }
        const stickers = await this.favoriteStickerService.getFavoriteStickers()
        return this.serialize(stickers)
      }

      default:
        throw new KernelNotFoundError(`Unknown action '${type}' in module '${this.namespace}'`)
    }
  }

  private getSocketOrThrow(): IMessageActionSocket {
    const sock = this.getSock?.()
    if (!sock) {
      throw new KernelError('INTERNAL_ERROR', 'WhatsApp connection socket is not available')
    }
    return sock
  }
}

