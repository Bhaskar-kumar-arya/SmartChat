import { BaileysMessage, WASocket } from '../whatsapp/types'
import { DBMessageWithSender } from '../../domain/types'
import { EnrichedMessage } from '../../ipc/types'
import { ParsedMessage } from './MessageParser'

export interface IMessageQueryService {
  isSpecialMessage(msg: BaileysMessage): boolean

  parseMessageSync(msg: BaileysMessage): ParsedMessage | null

  getChatMessages(
    jid: string,
    page?: number,
    pageSize?: number,
    sock?: WASocket | null,
    resolveLid?: boolean,
    includeReactions?: boolean
  ): Promise<EnrichedMessage[]>

  enrichMessage(
    msg: DBMessageWithSender,
    sock: WASocket | null,
    nameMap: Map<string, string>
  ): Promise<EnrichedMessage>

  getSafeMediaFileName(
    msgId: string,
    mediaType: string,
    mediaMsg: unknown
  ): string
}
