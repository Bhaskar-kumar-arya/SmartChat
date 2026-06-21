import { MessageUpsertData } from '../../domain/db.types'
import { IMessageCompoundRepository } from './IMessageCompoundRepository'
export type { MessageUpsertData }

export interface IMessageWriteRepository {
  upsertMessage(data: MessageUpsertData): Promise<void>
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
  bulkSyncMessages(rows: MessageUpsertData[]): Promise<void>
  updateMessageDeleted(id: string): Promise<void>
}

export interface IMessageRepository extends IMessageWriteRepository, IMessageCompoundRepository {}
