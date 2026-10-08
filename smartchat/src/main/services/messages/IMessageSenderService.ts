import { IMessageActionSocket } from './IMessageActionService'
import { EnrichedMessage } from '../../ipc/message.types'

export interface IMessageSenderService {
  sendMessageWorkflow(
    sock: IMessageActionSocket,
    jid: string,
    text: string,
    quotedMsgId?: string,
    mentions?: string[]
  ): Promise<EnrichedMessage>

  sendMediaMessageWorkflow(
    sock: IMessageActionSocket,
    jid: string,
    filePath: string,
    caption?: string,
    quotedMsgId?: string,
    mentions?: string[]
  ): Promise<EnrichedMessage>

  /**
   * Re-sends a FAILED outgoing message (text or media, with its quote and mentions) as a new
   * message and removes the failed row. Rejects if the message is not a FAILED outgoing one.
   */
  retryFailedMessage(sock: IMessageActionSocket, jid: string, messageId: string): Promise<EnrichedMessage>
}
