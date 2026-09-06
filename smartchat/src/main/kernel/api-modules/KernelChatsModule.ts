import { BaseKernelModule } from './BaseKernelModule'
import { IPermissionStore } from '../permissions/IPermissionStore'
import { IChatService } from '../../services/chats/IChatService'
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
        const list = await this.chatService.getChatList(page, limit)
        // Filter to the plugin's allowed chats — a scoped plugin must not see
        // names / last-message previews for chats outside its allow-list.
        // isResourceAllowed() is default-allow, so unscoped plugins are unaffected. (S7-01)
        const scoped = list.filter(
          (chat) => !chat?.jid || this.permissions.isResourceAllowed(pluginId, 'chats:read', chat.jid)
        )
        return this.serialize(scoped)
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
