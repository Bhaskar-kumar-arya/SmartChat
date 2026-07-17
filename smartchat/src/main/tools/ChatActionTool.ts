import { AITool, ToolExecutionContext, ToolResult } from '../services/ai/IToolRegistry'
import { IChatActionService } from '../services/chats/IChatActionService'
import { WASocket } from '../services/whatsapp/types'
import { IWAEventBus } from '../services/whatsapp/IWAEventBus'
import { ChatUpdatePayload } from '../domain/whatsapp.types'

export class ChatActionTool implements AITool {
  name = 'chatAction'
  description = `Perform an action on a WhatsApp chat (e.g., mute, pin, mark read).
  
CAN BE USED FOR:
- Muting or unmuting a chat
- Pinning or unpinning a chat
- Archiving or unarchiving a chat
- Marking a chat as read or unread

HOW TO USE:
- 'action' is required (e.g., 'mute', 'unmute', 'pin', 'unpin', 'archive', 'unarchive', 'mark_read', 'mark_unread')
- 'jid' is required (the chat's JID)
- For 'mute', you may specify a 'duration' ('8_hours', '1_week', 'always'). Defaults to '8_hours'.

WHAT YOU RECEIVE BACK:
- { "success": true, "detail": "<success message>" }
`

  requiresPermission = true

  parametersSchema = {
    type: 'object',
    properties: {
      action: {
        type: 'string',
        enum: ['mute', 'unmute', 'pin', 'unpin', 'archive', 'unarchive', 'mark_read', 'mark_unread'],
        description: 'The chat action to perform.'
      },
      jid: {
        type: 'string',
        description: 'The unique JID of the chat.'
      },
      duration: {
        type: 'string',
        enum: ['8_hours', '1_week', 'always'],
        description: 'Required only for mute. Defaults to 8_hours.'
      }
    },
    required: ['action', 'jid']
  }

  constructor(
    private readonly getSock: () => WASocket | null,
    private readonly chatActionService: IChatActionService,
    private readonly getBus: () => IWAEventBus | null
  ) {}

  async execute(args: Record<string, unknown>, _ctx?: ToolExecutionContext): Promise<ToolResult> {
    const action = args.action as string
    const jid = args.jid as string
    const duration = args.duration as string | undefined

    if (!action || !jid) {
      throw new Error('Missing required arguments: action, jid')
    }

    const sock = this.getSock()
    if (!sock) throw new Error('WhatsApp socket is not connected')

    let res: { success: boolean; detail: string }

    switch (action) {
      case 'mute': {
        let muteExpiration = Date.now() + 8 * 60 * 60 * 1000 // default 8 hours
        if (duration === '1_week') {
          muteExpiration = Date.now() + 7 * 24 * 60 * 60 * 1000
        } else if (duration === 'always') {
          muteExpiration = -1
        }
        res = await this.chatActionService.muteChat(sock, jid, muteExpiration)
        break
      }
      case 'unmute':
        res = await this.chatActionService.muteChat(sock, jid, null)
        break
      case 'pin':
        res = await this.chatActionService.pinChat(sock, jid, true)
        break
      case 'unpin':
        res = await this.chatActionService.pinChat(sock, jid, false)
        break
      case 'archive':
        res = await this.chatActionService.archiveChat(sock, jid, true)
        this.notifyFrontendChatUpdate(jid, { archived: true })
        break
      case 'unarchive':
        res = await this.chatActionService.archiveChat(sock, jid, false)
        this.notifyFrontendChatUpdate(jid, { archived: false })
        break
      case 'mark_read':
        res = await this.chatActionService.markChatRead(sock, jid, true)
        this.notifyFrontendChatUpdate(jid, { unreadCount: 0 })
        break
      case 'mark_unread':
        res = await this.chatActionService.markChatRead(sock, jid, false)
        this.notifyFrontendChatUpdate(jid, { unreadCount: 1 })
        break
      default:
        throw new Error(`Unknown action: ${action}`)
    }

    return { text: JSON.stringify(res) }
  }

  private notifyFrontendChatUpdate(jid: string, update: ChatUpdatePayload): void {
    this.getBus()?.emit('chat:updated', { jid, update }).catch((err) => {
      console.error('[ChatActionTool] Failed to emit chat:updated event:', err)
    })
  }
}
