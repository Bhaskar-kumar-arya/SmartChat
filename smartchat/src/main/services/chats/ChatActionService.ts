import { IChatMutationService } from './IChatService'
import { IChatActionService, IChatActionSocket } from './IChatActionService'

export class ChatActionService implements IChatActionService {
  constructor(private readonly chatMutationService: IChatMutationService) {}

  async muteChat(sock: IChatActionSocket, jid: string, durationMs: number | null): Promise<{ success: boolean; detail: string }> {
    try {
      await sock.chatModify({ mute: durationMs }, jid)
      return { success: true, detail: `Chat ${jid} ${durationMs === null ? 'unmuted' : 'muted'} successfully.` }
    } catch (err) {
      console.error(`[ChatActionService] Failed to mute chat ${jid}:`, err)
      throw new Error(`Failed to mute chat ${jid}: ${err}`)
    }
  }

  async pinChat(sock: IChatActionSocket, jid: string, pin: boolean): Promise<{ success: boolean; detail: string }> {
    try {
      await sock.chatModify({ pin }, jid)
      return { success: true, detail: `Chat ${jid} ${pin ? 'pinned' : 'unpinned'} successfully.` }
    } catch (err) {
      console.error(`[ChatActionService] Failed to pin chat ${jid}:`, err)
      throw new Error(`Failed to pin chat ${jid}: ${err}`)
    }
  }

  async markChatRead(_sock: IChatActionSocket, jid: string, read: boolean): Promise<{ success: boolean; detail: string }> {
    try {
      if (read) {
        await this.chatMutationService.markRead(jid)
      } else {
        await this.chatMutationService.upsertChat(jid, { unreadCount: 1 })
      }
      return { success: true, detail: `Chat ${jid} marked as ${read ? 'read' : 'unread'} locally.` }
    } catch (err) {
      console.error(`[ChatActionService] Failed to mark chat ${jid} as read:`, err)
      throw new Error(`Failed to mark chat ${jid} as read: ${err}`)
    }
  }

  async archiveChat(_sock: IChatActionSocket, jid: string, archive: boolean): Promise<{ success: boolean; detail: string }> {
    try {
      await this.chatMutationService.upsertChat(jid, { archived: archive })
      return { success: true, detail: `Chat ${jid} ${archive ? 'archived' : 'unarchived'} locally.` }
    } catch (err) {
      console.error(`[ChatActionService] Failed to archive chat ${jid}:`, err)
      throw new Error(`Failed to archive chat ${jid}: ${err}`)
    }
  }
}
