import type { CallLogEntry } from './ICallService'

export interface ICallRepository {
  getCallLog(id: string): Promise<CallLogEntry | null>
  upsertCallLog(entry: CallLogEntry): Promise<void>
}
