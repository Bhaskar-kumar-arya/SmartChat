import { PrismaClient, MessageReceipt, Message } from '@prisma/client'
import { IReceiptRepository } from './IReceiptRepository'

export class ReceiptRepository implements IReceiptRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async findMessageById(id: string): Promise<Message | null> {
    return this.prisma.message.findUnique({
      where: { id }
    });
  }

  async updateMessageStatus(id: string, status: string): Promise<void> {
    await this.prisma.message.update({
      where: { id },
      data: { status }
    });
  }

  async upsertMessageReceipt(data: {
    messageId: string;
    userJid: string;
    status: string;
    timestamp: bigint;
  }): Promise<void> {
    await this.prisma.messageReceipt.upsert({
      where: {
        messageId_userJid: {
          messageId: data.messageId,
          userJid: data.userJid
        }
      },
      update: {
        status: data.status,
        timestamp: data.timestamp
      },
      create: {
        messageId: data.messageId,
        userJid: data.userJid,
        status: data.status,
        timestamp: data.timestamp
      }
    });
  }

  async getChatMembersCount(chatJid: string): Promise<number> {
    return this.prisma.chatMember.count({
      where: { chatJid }
    });
  }

  async getMessageReceiptsCount(messageId: string, status: string): Promise<number> {
    return this.prisma.messageReceipt.count({
      where: {
        messageId,
        status
      }
    });
  }

  async getMessageReceiptsWithStatusesCount(messageId: string, statuses: string[]): Promise<number> {
    return this.prisma.messageReceipt.count({
      where: {
        messageId,
        status: { in: statuses }
      }
    });
  }

  async getMessageReceipts(messageId: string): Promise<MessageReceipt[]> {
    return this.prisma.messageReceipt.findMany({
      where: { messageId },
      orderBy: { timestamp: 'desc' }
    });
  }
}
