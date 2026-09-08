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
  /** Key of the oldest stored message for a chat (or null if none). */
  findOldestMessageKey(
    chatJid: string
  ): Promise<{ id: string; fromMe: boolean; timestamp: bigint } | null>
  /**
   * Fetches messages anchored at `fromTimestamp`:
   *  - Up to `forwardLimit` messages with timestamp >= `fromTimestamp` (target → newer).
   *  - Up to `lookBehind` messages before it for context.
   * Returns the combined list in chronological order. The forward side is capped
   * so a "jump to old message" in a busy chat cannot load tens of thousands of
   * rows into one IPC call. (P2-S2-02)
   */
  findMessagesFromTimestamp(
    chatJid: string,
    fromTimestamp: bigint,
    lookBehind: number,
    forwardLimit?: number
  ): Promise<Array<Message & { sender: Identity | null }>>
}

export interface IMessageQueryRepository
  extends IMessageExistenceRepository,
    IMessageReadRepository,
    IMessageSearchRepository,
    IMessageIndexRepository {}
