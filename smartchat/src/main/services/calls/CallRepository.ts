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
    // S11-05: Baileys re-delivers queued `call` events on reconnect and call
    // state can arrive out of order. Never let a stale event clobber a newer /
    // terminal row: skip the update when the incoming event is older, or when
    // it would regress an already-resolved call back to a non-terminal state.
    const existing = await this.prisma.callLog.findUnique({ where: { id: entry.id } })
    if (existing) {
      const olderEvent = entry.timestamp < existing.timestamp
      const regressesTerminal =
        CallRepository.isTerminalStatus(existing.status) &&
        !CallRepository.isTerminalStatus(entry.status)
      if (olderEvent || regressesTerminal) {
        return
      }
      await this.prisma.callLog.update({
        where: { id: entry.id },
        data: {
          callerJid: entry.callerJid,
          isVideo: entry.isVideo,
          isGroup: entry.isGroup,
          status: entry.status,
          // P2-S3-03: a single call fires several events (offer → ringing →
          // terminate). Keep the first-seen timestamp (the call's start) rather
          // than letting each later status update push it forward.
          timestamp: existing.timestamp < entry.timestamp ? existing.timestamp : entry.timestamp
        }
      })
      return
    }

    try {
      await this.prisma.callLog.create({
        data: {
          id: entry.id,
          callerJid: entry.callerJid,
          isVideo: entry.isVideo,
          isGroup: entry.isGroup,
          status: entry.status,
          timestamp: entry.timestamp
        }
      })
    } catch {
      // Lost a race to a concurrent insert — re-run through the guarded path.
      await this.upsertCallLog(entry)
    }
  }

  private static isTerminalStatus(status: string): boolean {
    return status === 'accept' || status === 'reject' || status === 'timeout' || status === 'terminate'
  }
}
