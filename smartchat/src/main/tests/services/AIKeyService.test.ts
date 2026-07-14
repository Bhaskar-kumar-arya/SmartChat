import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { AIKeyService } from '../../services/ai/AIKeyService'
import { IKeyStorage } from '../../services/ai/IKeyStorage'

describe('AIKeyService', () => {
  let service: AIKeyService
  let storage: import('vitest').Mocked<IKeyStorage>
  let originalEnv: NodeJS.ProcessEnv

  beforeEach(() => {
    originalEnv = { ...process.env }
    storage = {
      loadKeys: vi.fn().mockReturnValue({}),
      saveKeys: vi.fn()
    }
  })

  afterEach(() => {
    process.env = originalEnv
  })

  it('loads default keys if storage and env are empty', () => {
    delete process.env.GEMINI_API_KEY
    service = new AIKeyService(storage)
    const keys = service.getKeys()
    expect(keys.gemini).toBeDefined()
    expect(keys.groq).toBeDefined()
  })

  it('overrides defaults with env variables', () => {
    process.env.GEMINI_API_KEY = 'env-gemini-key'
    service = new AIKeyService(storage)
    const keys = service.getKeys()
    expect(keys.gemini).toBe('env-gemini-key')
  })

  it('overrides defaults and env with stored keys', () => {
    process.env.GEMINI_API_KEY = 'env-gemini-key'
    storage.loadKeys.mockReturnValue({ gemini: 'stored-gemini-key' })
    
    service = new AIKeyService(storage)
    const keys = service.getKeys()
    expect(keys.gemini).toBe('stored-gemini-key')
  })

  it('saveKey updates in memory and persists to storage', () => {
    service = new AIKeyService(storage)
    service.saveKey('gemini', 'new-saved-key')
    
    expect(service.getKey('gemini')).toBe('new-saved-key')
    expect(storage.saveKeys).toHaveBeenCalledWith(expect.objectContaining({ gemini: 'new-saved-key' }))
  })
})
