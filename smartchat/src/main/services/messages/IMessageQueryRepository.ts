import { Message, Identity } from '../../domain/entities'
import { IMessageExistenceRepository } from './IMessageExistenceRepository'
import { IMessageSearchRepository } from './IMessageSearchRepository'
import { IMessageIndexRepository } from './IMessageIndexRepository'

export interface IMessageReadRepository {
  findMessagesByIds(ids: string[]): Promise<Message[]>
  findMessageById(id: string): Promise<Message | null>
  findMessageWithSender(id: string): Promise<(Message & { sender: Identity | null }) | null>
  findChatMessagesWithSender(
    chatJid: string,
    skip: number,
    take: number
  ): Promise<Array<Message & { sender: Identity | null }>>
  findMessageTypeAndContent(id: string): Promise<{ messageType: string; textContent: string | null } | null>
  findMessagesByChat(chatJid: string, limit: number): Promise<Message[]>
  /**
   * Fetches all messages from `fromTimestamp` (inclusive) to newest, plus
   * `lookBehind` messages before it for context. Returns list in chronological order.
   */
  findMessagesFromTimestamp(
    chatJid: string,
    fromTimestamp: bigint,
    lookBehind: number
  ): Promise<Array<Message & { sender: Identity | null }>>
}

export interface IMessageQueryRepository
  extends IMessageExistenceRepository,
    IMessageReadRepository,
    IMessageSearchRepository,
    IMessageIndexRepository {}
