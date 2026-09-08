import { basename, join, resolve, sep } from 'path'
import { BaseKernelModule } from './BaseKernelModule'
import { IPermissionStore } from '../permissions/IPermissionStore'
import { IMessageQueryService } from '../../services/messages/IMessageQueryService'
import { IMessageActionService, IMessageActionSocket } from '../../services/messages/IMessageActionService'
import { IMediaService } from '../../services/messages/IMediaService'
import { IReceiptService } from '../../services/whatsapp/IReceiptService'
import { IFavoriteStickerService } from '../../services/messages/IFavoriteStickerService'
import { KernelError, KernelNotFoundError } from './KernelErrors'

/** Minimal message → owning-chat lookup (satisfied by IMessageQueryRepository). */
export interface IMessageOwnerLookup {
  findMessageById(id: string): Promise<{ chatJid: string } | null>
}

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
    private readonly favoriteStickerService?: IFavoriteStickerService,
    private readonly messageOwnerLookup?: IMessageOwnerLookup
  ) {
    super(permissions)
  }

  /**
   * Resolve the chat a message actually belongs to and enforce resource scope
   * against THAT jid — a plugin must not be able to act on a message outside
   * its allow-list by omitting the optional `jid` or passing one it does own
   * alongside a `messageId` from another chat. (S7-01)
   */
  private async requireMessageScope(
    pluginId: string,
    capability: string,
    messageId: string,
    providedJid?: string
  ): Promise<void> {
    let ownerJid = providedJid
    const found = await this.messageOwnerLookup?.findMessageById(messageId)
    if (found?.chatJid) {
      // Authoritative: scope on the message's real chat.
      ownerJid = found.chatJid
    } else if (found === null && !providedJid) {
      // Lookup ran and the message genuinely does not exist.
      throw new KernelNotFoundError(`Message '${messageId}' not found`)
    }
    if (ownerJid) {
      this.requireResourceScope(pluginId, capability, ownerJid)
    }
    // else: no owner lookup wired and no jid supplied — nothing to scope on.
    // In production the lookup is always injected, so a scoped plugin cannot
    // reach this branch; unscoped plugins are unaffected either way.
  }

  /**
   * `sendMedia` reads an arbitrary path off disk and uploads it. `messages:send`
   * (even chat-scoped) must NOT double as "read any local file and exfiltrate it
   * as media". Restrict the source path to files the plugin can legitimately
   * reach: its own extension directory, or the app's media cache (which it can
   * already read via `downloadMedia`). (S7-02)
   */
  private resolveSendableMediaPath(pluginId: string, filePath: string): string {
    if (typeof filePath !== 'string' || filePath.length === 0) {
      throw new KernelError('BAD_REQUEST', 'sendMedia requires a non-empty filePath')
    }
    const userData = this.getUserDataPath?.()
    if (!userData) {
      throw new KernelError('INTERNAL_ERROR', 'sendMedia is unavailable: no user-data path configured')
    }
    const resolved = resolve(filePath)
    const allowedRoots = [
      resolve(userData, 'media'),
      resolve(userData, 'extensions', pluginId)
    ]
    const contained = allowedRoots.some(
      (root) => resolved === root || resolved.startsWith(root + sep)
    )
    if (!contained) {
      throw new KernelError(
        'PERMISSION_DENIED',
        `Plugin '${pluginId}' may only send files from its own extension directory or the app media cache`
      )
    }
    return resolved
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
        const safeFilePath = this.resolveSendableMediaPath(pluginId, filePath)
        const sock = this.getSocketOrThrow()
        const qMsgId = options?.quotedMsgId || quotedMsgId
        const mList = options?.mentions || mentions
        const msg = await this.messageActionService.sendMediaMessageWorkflow(
          sock,
          jid,
          safeFilePath,
          caption,
          qMsgId,
          mList
        )
        return this.serialize(msg)
      }

      case 'edit': {
        const { messageId, newText, jid } = payload as { messageId: string; newText: string; jid?: string }
        this.requireCapability(pluginId, 'messages:send')
        await this.requireMessageScope(pluginId, 'messages:send', messageId, jid)
        const sock = this.getSocketOrThrow()
        const msg = await this.messageActionService.editMessage(sock, messageId, newText, jid)
        return this.serialize(msg)
      }

      case 'forward': {
        const { messageId, targetJids, jid } = payload as { messageId: string; targetJids: string[]; jid?: string }
        this.requireCapability(pluginId, 'messages:send')
        // Scope on the source message's real chat...
        await this.requireMessageScope(pluginId, 'messages:send', messageId, jid)
        // ...and on every destination — forwarding delivers the message there.
        for (const targetJid of targetJids || []) {
          this.requireResourceScope(pluginId, 'messages:send', targetJid)
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
        await this.requireMessageScope(pluginId, 'messages:read', messageId)
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
          // `localURI` comes back from persisted message content — strip the
          // scheme, then `basename` to drop any `..` / separator trickery, and
          // assert containment under <userData>/media before handing the path
          // to the plugin as authoritative. (S7-06, reuses resolveSendableMediaPath)
          const fileName = basename(
            localURI.replace(/^app:\/\/media\//, '').replace(/^app:\/\//, '')
          )
          const userDataPath = this.getUserDataPath?.()
          if (userDataPath && fileName) {
            try {
              filePath = this.resolveSendableMediaPath(pluginId, join(userDataPath, 'media', fileName))
            } catch {
              filePath = null
            }
          }
        }

        return this.serialize({ success: true, localURI, filePath, message: enriched })
      }

      case 'getReceipts': {
        const { messageId } = payload as { messageId: string }
        this.requireCapability(pluginId, 'messages:read')
        await this.requireMessageScope(pluginId, 'messages:read', messageId)
        if (!this.receiptService) {
          throw new KernelError('INTERNAL_ERROR', 'ReceiptService is not available in KernelMessagesModule')
        }
        const receipts = await this.receiptService.getMessageReceipts(messageId, null)
        return this.serialize(receipts)
      }

      case 'addFavoriteSticker': {
        const { messageId } = payload as { messageId: string }
        this.requireCapability(pluginId, 'messages:write')
        await this.requireMessageScope(pluginId, 'messages:write', messageId)
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

