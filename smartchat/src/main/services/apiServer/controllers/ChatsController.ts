import http from 'http'
import { IChatService } from '../../chats/IChatService'
import { IMessageActionService } from '../../messages/IMessageActionService'
import { WASocket } from '../../whatsapp/types'
import { readRequestBody, sendJSON } from './helpers'

interface SendMessageBody {
  jid: string
  text: string
  mentions?: string[]
}

function isSendMessageBody(obj: unknown): obj is SendMessageBody {
  return (
    typeof obj === 'object' &&
    obj !== null &&
    'jid' in obj &&
    'text' in obj &&
    typeof (obj as SendMessageBody).jid === 'string' &&
    typeof (obj as SendMessageBody).text === 'string'
  )
}

export class ChatsController {
  constructor(
    private readonly chatService: IChatService,
    private readonly messageActionService: IMessageActionService,
    private readonly getSock: () => WASocket | null
  ) {}

  getChats = async (_req: http.IncomingMessage, res: http.ServerResponse): Promise<void> => {
    const chats = await this.chatService.getChatList(1, 100)
    sendJSON(res, 200, chats)
  }

  sendMessage = async (req: http.IncomingMessage, res: http.ServerResponse): Promise<void> => {
    try {
      const body = await readRequestBody(req)
      const data: unknown = JSON.parse(body)
      if (!isSendMessageBody(data)) {
        sendJSON(res, 400, { error: 'Bad Request: Missing required fields "jid" (string) and "text" (string)' })
        return
      }

      const sock = this.getSock()
      if (!sock) {
        sendJSON(res, 503, { error: 'WhatsApp socket is not connected' })
        return
      }

      const result = await this.messageActionService.sendMessageWorkflow(
        sock,
        data.jid,
        data.text,
        undefined,
        data.mentions
      )
      sendJSON(res, 200, { success: true, result })
    } catch (err) {
      sendJSON(res, 400, { error: `Invalid Request Body/Error: ${err instanceof Error ? err.message : String(err)}` })
    }
  }
}
