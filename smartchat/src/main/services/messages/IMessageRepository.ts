import { DBMessageWithSender, MessageUpsertData } from '../../domain/types'
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
  updateMessageContent(messageId: string, content: string): Promise<void>
  bulkSyncMessages(rows: MessageUpsertData[]): Promise<void>
  updateMessageDeleted(id: string): Promise<void>
  updateAndFetchMessageWithSender(
    id: string,
    textContent: string,
    content: string
  ): Promise<DBMessageWithSender | null>
  updateContentAndFetchWithSender(
    id: string,
    content: string
  ): Promise<DBMessageWithSender | null>
}

export interface IMessageRepository extends IMessageWriteRepository {}
