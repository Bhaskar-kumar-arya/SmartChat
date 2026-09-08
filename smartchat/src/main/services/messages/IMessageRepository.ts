import { MessageUpsertData } from '../../domain/db.types'
import { IMessageCompoundRepository } from './IMessageCompoundRepository'
export type { MessageUpsertData }

export interface IMessageWriteRepository {
  upsertMessage(data: MessageUpsertData): Promise<{ content: string; messageType: string; textContent: string | null }>
  bulkCreateMessages(rows: MessageUpsertData[]): Promise<void>
  revokeMessage(messageId: string): Promise<void>
  editMessage(
    messageId: string,
    textContent: string | null,
    editedContent: Record<string, unknown> | null
  ): Promise<void>
  decryptMessage(
    messageId: string,
    messageType: string,
    textContent: string | null,
    content: Record<string, unknown>
  ): Promise<void>
  updateMessageContent(messageId: string, content: string): Promise<void>
  /**
   * Persists a batch of sync rows and returns only the rows that were newly
   * inserted (not the ones already present in the DB). (P2-S4-06)
   */
  bulkSyncMessages(rows: MessageUpsertData[]): Promise<MessageUpsertData[]>
  updateMessageDeleted(id: string): Promise<void>
}

export interface IMessageRepository extends IMessageWriteRepository, IMessageCompoundRepository { }
