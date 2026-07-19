import { PrismaClient } from '@prisma/client'
import { IDedicatedChatRepository } from './IDedicatedChatRepository'
import { DedicatedChatMessage } from '../context/ExtensionContext'

export class DedicatedChatRepository implements IDedicatedChatRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async append(extensionId: string, role: 'user' | 'extension', content: string): Promise<void> {
    await this.prisma.extensionChatMessage.create({
      data: {
        extensionId,
        role,
        content
      }
    })
  }

  async getHistory(extensionId: string, limit: number = 50): Promise<DedicatedChatMessage[]> {
    const rows = await this.prisma.extensionChatMessage.findMany({
      where: { extensionId },
      orderBy: { createdAt: 'desc' },
      take: limit
    })
    
    return rows.reverse().map(r => ({
      id: r.id,
      extensionId: r.extensionId,
      role: r.role as 'user' | 'extension',
      content: r.content,
      createdAt: r.createdAt
    }))
  }

  async clear(extensionId: string): Promise<void> {
    await this.prisma.extensionChatMessage.deleteMany({
      where: { extensionId }
    })
  }
}
