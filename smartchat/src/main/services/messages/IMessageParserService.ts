import { ParsedMessage } from './MessageParser'

export interface IMessageParserService {
  isSpecialMessage(msg: unknown): boolean

  parseMessageSync(msg: unknown): ParsedMessage | null

  getSafeMediaFileName(
    msgId: string,
    mediaType: string,
    mediaMsg: unknown
  ): string
}
