import { WASocket } from '../whatsapp/types'
import { EnrichedMessage } from '../../ipc/message.types'

export interface IMessageActionService {
  deleteMessage(
    sock: WASocket,
    messageId: string,
    jid?: string
  ): Promise<{ success: boolean; detail: string; messageId: string }>

  editMessage(
    sock: WASocket,
    messageId: string,
    newText: string,
    jid?: string
  ): Promise<EnrichedMessage>

  forwardMessage(
    sock: WASocket,
    messageId: string,
    targetJids: string[],
    jid?: string
  ): Promise<{ success: boolean; detail: string; results: Array<{ jid: string; messageId: string }> }>

  reactToMessage(
    sock: WASocket,
    messageId: string,
    reaction: string,
    jid?: string
  ): Promise<{ success: boolean; detail: string; messageId: string; reaction: string }>

  sendMessageWorkflow(
    sock: WASocket,
    jid: string,
    text: string,
    quotedMsgId?: string,
    mentions?: string[]
  ): Promise<EnrichedMessage>

  sendMediaMessageWorkflow(
    sock: WASocket,
    jid: string,
    filePath: string,
    caption?: string,
    quotedMsgId?: string,
    mentions?: string[]
  ): Promise<EnrichedMessage>
}
