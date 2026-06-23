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
}
