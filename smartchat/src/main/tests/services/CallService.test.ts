import { describe, it, expect, vi, beforeEach } from 'vitest'
import { CallService } from '../../services/calls/CallService'
import { ICallRepository } from '../../services/calls/ICallRepository'
import { CallLogEntry } from '../../services/calls/ICallService'

describe('CallService', () => {
  let service: CallService
  let repo: import('vitest').Mocked<ICallRepository>

  beforeEach(() => {
    repo = {
      getCallLog: vi.fn(),
      upsertCallLog: vi.fn(),
    }
    service = new CallService(repo)
  })

  it('getCallLog delegates to repository', async () => {
    repo.getCallLog.mockResolvedValue({ id: 'c1' } as CallLogEntry)
    const result = await service.getCallLog('c1')
    expect(result?.id).toBe('c1')
    expect(repo.getCallLog).toHaveBeenCalledWith('c1')
  })

  it('upsertCallLog delegates to repository', async () => {
    const entry: CallLogEntry = { id: 'c2', callerJid: 'user', isVideo: true, isGroup: false, status: 'offer', timestamp: 12345n }
    await service.upsertCallLog(entry)
    expect(repo.upsertCallLog).toHaveBeenCalledWith(entry)
  })
})
