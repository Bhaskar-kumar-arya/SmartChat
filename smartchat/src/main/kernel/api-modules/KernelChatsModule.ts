import { BaseKernelModule } from './BaseKernelModule'
import { IPermissionStore } from '../permissions/IPermissionStore'
import { IChatService } from '../../services/chats/IChatService'
import { ChatListEntry } from '../../domain/chatList.types'
import { IChatActionService, IChatActionSocket } from '../../services/chats/IChatActionService'
import { KernelError, KernelNotFoundError } from './KernelErrors'

export class KernelChatsModule extends BaseKernelModule {
  readonly namespace = 'kernel:chats'

  constructor(
    permissions: IPermissionStore,
    private readonly chatService: IChatService,
    private readonly chatActionService?: IChatActionService,
    private readonly getSock?: () => IChatActionSocket | null
  ) {
    super(permissions)
  }

  async handle(pluginId: string, type: string, payload: unknown): Promise<unknown> {
    const action = this.extractAction(type)

    switch (action) {
      case 'getList': {
        this.requireCapability(pluginId, 'chats:read')
        const { page = 1, limit = 50 } = (payload as { page?: number; limit?: number }) || {}
        const allow = (chat: ChatListEntry): boolean =>
          !chat?.jid || this.permissions.isResourceAllowed(pluginId, 'chats:read', chat.jid)

        // Fast path — the plugin is not chat-scoped for this page: return the DB
        // page verbatim, unchanged semantics.
        const firstPage = await this.chatService.getChatList(page, limit)
        if (firstPage.every(allow)) {
          return this.serialize(firstPage)
        }

        // Scoped plugin: the DB pagination window and the count of visible
        // (allowed) rows diverge, so an empty filtered page looks like the end
        // of the list even when more allowed chats sit on a later DB page. Walk
        // the source and return a stable page over the *filtered* set instead. (S7-05)
        const SRC_PAGE_SIZE = 200
        const need = page * limit
        const collected: ChatListEntry[] = []
        for (let srcPage = 1; srcPage <= 1000 && collected.length < need; srcPage++) {
          const batch = await this.chatService.getChatList(srcPage, SRC_PAGE_SIZE)
          for (const chat of batch) {
            if (allow(chat)) collected.push(chat)
          }
          if (batch.length < SRC_PAGE_SIZE) break
        }
        return this.serialize(collected.slice((page - 1) * limit, page * limit))
      }

      case 'getById': {
        const { jid } = payload as { jid: string }
        this.requireCapability(pluginId, 'chats:read')
        this.requireResourceScope(pluginId, 'chats:read', jid)
        const chat = await this.chatService.getChatByJid(jid)
        return this.serialize(chat)
      }

      case 'getGroupParticipants': {
        const { jid } = payload as { jid: string }
        this.requireCapability(pluginId, 'chats:read')
        this.requireResourceScope(pluginId, 'chats:read', jid)
        const participants = await this.chatService.getGroupParticipants(jid)
        return this.serialize(participants)
      }

      case 'pin': {
        const { jid } = payload as { jid: string }
        this.requireCapability(pluginId, 'chats:write')
        this.requireResourceScope(pluginId, 'chats:write', jid)
        const sock = this.getSocketOrThrow()
        return await this.chatActionService!.pinChat(sock, jid, true)
      }

      case 'unpin': {
        const { jid } = payload as { jid: string }
        this.requireCapability(pluginId, 'chats:write')
        this.requireResourceScope(pluginId, 'chats:write', jid)
        const sock = this.getSocketOrThrow()
        return await this.chatActionService!.pinChat(sock, jid, false)
      }

      case 'archive': {
        const { jid } = payload as { jid: string }
        this.requireCapability(pluginId, 'chats:write')
        this.requireResourceScope(pluginId, 'chats:write', jid)
        const sock = this.getSocketOrThrow()
        return await this.chatActionService!.archiveChat(sock, jid, true)
      }

      case 'unarchive': {
        const { jid } = payload as { jid: string }
        this.requireCapability(pluginId, 'chats:write')
        this.requireResourceScope(pluginId, 'chats:write', jid)
        const sock = this.getSocketOrThrow()
        return await this.chatActionService!.archiveChat(sock, jid, false)
      }

      case 'mute': {
        const { jid, durationMs } = payload as { jid: string; durationMs: number }
        this.requireCapability(pluginId, 'chats:write')
        this.requireResourceScope(pluginId, 'chats:write', jid)
        const sock = this.getSocketOrThrow()
        return await this.chatActionService!.muteChat(sock, jid, durationMs)
      }

      case 'unmute': {
        const { jid } = payload as { jid: string }
        this.requireCapability(pluginId, 'chats:write')
        this.requireResourceScope(pluginId, 'chats:write', jid)
        const sock = this.getSocketOrThrow()
        return await this.chatActionService!.muteChat(sock, jid, null)
      }

      case 'markRead': {
        const { jid } = payload as { jid: string }
        this.requireCapability(pluginId, 'chats:write')
        this.requireResourceScope(pluginId, 'chats:write', jid)
        return await this.chatService.markRead(jid)
      }

      default:
        throw new KernelNotFoundError(`Unknown action '${type}' in module '${this.namespace}'`)
    }
  }

  private getSocketOrThrow(): IChatActionSocket {
    const sock = this.getSock?.()
    if (!sock || !this.chatActionService) {
      throw new KernelError('INTERNAL_ERROR', 'WhatsApp connection socket is not available')
    }
    return sock
  }
}
