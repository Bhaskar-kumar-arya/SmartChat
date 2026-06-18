import { Message } from '@prisma/client'
import { MessageUpsertData } from './MessageRepository'

export interface IMessageRepository {
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
  ): Promise<(Message & { sender: import('@prisma/client').Identity | null }) | null>
  updateContentAndFetchWithSender(
    id: string,
    content: string
  ): Promise<(Message & { sender: import('@prisma/client').Identity | null }) | null>
}
