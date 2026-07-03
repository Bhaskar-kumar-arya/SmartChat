import { PrismaClient } from '@prisma/client'
import type { ICallRepository } from './ICallRepository'
import type { CallLogEntry } from './ICallService'

export class CallRepository implements ICallRepository {
  constructor(private prisma: PrismaClient) {}

  async getCallLog(id: string): Promise<CallLogEntry | null> {
    const row = await this.prisma.callLog.findUnique({
      where: { id }
    })
    
    if (!row) return null

    return {
      id: row.id,
      callerJid: row.callerJid,
      isVideo: row.isVideo,
      isGroup: row.isGroup,
      status: row.status,
      timestamp: row.timestamp
    }
  }

  async upsertCallLog(entry: CallLogEntry): Promise<void> {
    await this.prisma.callLog.upsert({
      where: { id: entry.id },
      create: {
        id: entry.id,
        callerJid: entry.callerJid,
        isVideo: entry.isVideo,
        isGroup: entry.isGroup,
        status: entry.status,
        timestamp: entry.timestamp
      },
      update: {
        callerJid: entry.callerJid,
        isVideo: entry.isVideo,
        isGroup: entry.isGroup,
        status: entry.status,
        timestamp: entry.timestamp
      }
    })
  }
}
