import { MessageReceipt, Message } from '@prisma/client'

export interface IReceiptRepository {
  findMessageById(id: string): Promise<Message | null>;
  updateMessageStatus(id: string, status: string): Promise<void>;
  upsertMessageReceipt(data: {
    messageId: string;
    userJid: string;
    status: string;
    timestamp: bigint;
  }): Promise<void>;
  getChatMembersCount(chatJid: string): Promise<number>;
  getMessageReceiptsCount(messageId: string, status: string): Promise<number>;
  getMessageReceiptsWithStatusesCount(messageId: string, statuses: string[]): Promise<number>;
  getMessageReceipts(messageId: string): Promise<MessageReceipt[]>;
}
