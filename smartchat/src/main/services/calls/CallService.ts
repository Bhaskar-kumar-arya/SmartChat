import type { ICallQueryService, ICallMutationService, CallLogEntry } from './ICallService'
import type { ICallRepository } from './ICallRepository'

export class CallService implements ICallQueryService, ICallMutationService {
  constructor(private repository: ICallRepository) {}

  async getCallLog(id: string): Promise<CallLogEntry | null> {
    return this.repository.getCallLog(id)
  }

  async upsertCallLog(entry: CallLogEntry): Promise<void> {
    return this.repository.upsertCallLog(entry)
  }
}
