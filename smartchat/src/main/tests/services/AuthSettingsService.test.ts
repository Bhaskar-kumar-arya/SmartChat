import { describe, it, expect, vi, beforeEach } from 'vitest'
import { AuthSettingsService } from '../../services/auth/AuthSettingsService'
import { IAuthStateRepository } from '../../services/auth/IAuthStateRepository'

describe('AuthSettingsService', () => {
  let service: AuthSettingsService
  let repo: import('vitest').Mocked<IAuthStateRepository>

  beforeEach(() => {
    repo = {
      getValue: vi.fn(),
      setValue: vi.fn(),
      deleteValue: vi.fn(),
      deleteSession: vi.fn(),
      saveSession: vi.fn()
    } as any
    service = new AuthSettingsService(repo)
  })

  it('getSyncFullHistory returns true if value is "true"', async () => {
    repo.getValue.mockResolvedValue('true')
    expect(await service.getSyncFullHistory()).toBe(true)
    
    repo.getValue.mockResolvedValue('false')
    expect(await service.getSyncFullHistory()).toBe(false)
  })

  it('setSyncFullHistory sets correct string value', async () => {
    await service.setSyncFullHistory(true)
    expect(repo.setValue).toHaveBeenCalledWith('sync_full_history', 'true')
    
    await service.setSyncFullHistory(false)
    expect(repo.setValue).toHaveBeenCalledWith('sync_full_history', 'false')
  })

  it('getHistorySyncCompleted returns true if value is "true"', async () => {
    repo.getValue.mockResolvedValue('true')
    expect(await service.getHistorySyncCompleted()).toBe(true)
  })

  it('hasCreds returns true if creds exist', async () => {
    repo.getValue.mockResolvedValue('creds-data')
    expect(await service.hasCreds()).toBe(true)
    
    repo.getValue.mockResolvedValue(null)
    expect(await service.hasCreds()).toBe(false)
  })
})
