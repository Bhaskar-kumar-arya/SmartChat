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

  it('getSyncFullHistory is hard-wired to false (full-history sync removed)', async () => {
    repo.getValue.mockResolvedValue('true')
    expect(await service.getSyncFullHistory()).toBe(false)
  })

  it('setSyncFullHistory is a no-op (full-history sync removed)', async () => {
    await service.setSyncFullHistory(true)
    await service.setSyncFullHistory(false)
    expect(repo.setValue).not.toHaveBeenCalled()
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

  // Regression: audit S10-01 — a transient DB read failure must NOT be
  // swallowed into "no creds", which caused a logged-in user's data wipe.
  it('hasCreds propagates a read failure instead of returning false', async () => {
    repo.getValue.mockRejectedValue(new Error('database is locked'))
    await expect(service.hasCreds()).rejects.toThrow('database is locked')
  })

  it('getHistorySyncCompleted fails closed to true on a read error', async () => {
    repo.getValue.mockRejectedValue(new Error('database is locked'))
    expect(await service.getHistorySyncCompleted()).toBe(true)
  })

  it('getSyncFullHistory fails closed to false on a read error', async () => {
    repo.getValue.mockRejectedValue(new Error('database is locked'))
    expect(await service.getSyncFullHistory()).toBe(false)
  })
})
