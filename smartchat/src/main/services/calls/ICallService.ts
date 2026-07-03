export interface CallLogEntry {
  id: string
  callerJid: string
  isVideo: boolean
  isGroup: boolean
  status: string
  timestamp: bigint
}

export interface ICallQueryService {
  getCallLog(id: string): Promise<CallLogEntry | null>
}

export interface ICallMutationService {
  upsertCallLog(entry: CallLogEntry): Promise<void>
}
