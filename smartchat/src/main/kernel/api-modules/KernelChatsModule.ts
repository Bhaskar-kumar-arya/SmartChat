import { IKernelModule } from './IKernelModule'
import { IPermissionStore } from '../permissions/IPermissionStore'
import { IChatService } from '../../services/chats/IChatService'
import { IChatActionService, IChatActionSocket } from '../../services/chats/IChatActionService'

export class KernelChatsModule implements IKernelModule {
  readonly namespace = 'kernel:chats'

  constructor(
    private readonly permissions: IPermissionStore,
    private readonly chatService: IChatService,
    private readonly chatActionService?: IChatActionService,
    private readonly getSock?: () => IChatActionSocket | null
  ) {}

  async handle(pluginId: string, type: string, payload: unknown): Promise<unknown> {
    const action = this.extractAction(type)

    switch (action) {
      case 'getList': {
        this.requireCapability(pluginId, 'chats:read')
        const { page = 1, limit = 50 } = (payload as { page?: number; limit?: number }) || {}
        const list = await this.chatService.getChatList(page, limit)
        return this.serialize(list)
      }

      case 'getById': {
        const { jid } = payload as { jid: string }
        this.requireCapability(pluginId, 'chats:read')
        this.requireResourceScope(pluginId, 'chats:read', jid)
        const chat = await this.chatService.getChatByJid(jid)
        return this.serialize(chat)
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

  private getSocketOrThrow(): IChatActionSocket {
    const sock = this.getSock?.()
    if (!sock || !this.chatActionService) {
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
