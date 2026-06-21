import { AnyMessageContent, MiscMessageGenerationOptions } from '@whiskeysockets/baileys'
import { ISocketUserContext } from '../contacts/IContactService'
import { EnrichedMessage } from '../../ipc/message.types'

export interface IMessageActionSocket extends ISocketUserContext {
  sendMessage(
    jid: string,
    content: AnyMessageContent,
    options?: MiscMessageGenerationOptions
  ): Promise<any>
}

export interface IMessageActionService {
  deleteMessage(
    sock: IMessageActionSocket,
    messageId: string,
    jid?: string
  ): Promise<{ success: boolean; detail: string; messageId: string }>

  editMessage(
    sock: IMessageActionSocket,
    messageId: string,
    newText: string,
    jid?: string
  ): Promise<EnrichedMessage>

  forwardMessage(
    sock: IMessageActionSocket,
    messageId: string,
    targetJids: string[],
    jid?: string
  ): Promise<{ success: boolean; detail: string; results: Array<{ jid: string; messageId: string }> }>

  reactToMessage(
    sock: IMessageActionSocket,
    messageId: string,
    reaction: string,
    jid?: string
  ): Promise<{ success: boolean; detail: string; messageId: string; reaction: string }>

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
