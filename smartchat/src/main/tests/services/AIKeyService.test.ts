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

  // Regression: audit S6-01 — no live API keys may be baked into the source.
  it('ships no hardcoded keys when storage and env are empty', () => {
    delete process.env.GEMINI_API_KEY
    delete process.env.GROQ_API_KEY
    delete process.env.MISTRAL_API_KEY
    delete process.env.DEEPSEEK_API_KEY
    service = new AIKeyService(storage)
    const keys = service.getKeys()
    expect(keys.gemini).toBe('')
    expect(keys.groq).toBe('')
    expect(keys.mistral).toBe('')
    expect(keys.deepseek).toBe('')
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
