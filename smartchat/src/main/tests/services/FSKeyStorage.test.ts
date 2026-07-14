import { describe, it, expect, vi, beforeEach } from 'vitest'
import { FSKeyStorage } from '../../services/ai/FSKeyStorage'
import * as fs from 'fs'

vi.mock('electron', () => ({
  app: {
    getPath: vi.fn().mockReturnValue('/mock/userData')
  }
}))

vi.mock('fs', () => ({
  existsSync: vi.fn(),
  readFileSync: vi.fn(),
  mkdirSync: vi.fn(),
  writeFileSync: vi.fn()
}))

describe('FSKeyStorage', () => {
  let storage: FSKeyStorage

  beforeEach(() => {
    storage = new FSKeyStorage()
    vi.clearAllMocks()
  })

  it('loadKeys returns empty object if file does not exist', () => {
    vi.mocked(fs.existsSync).mockReturnValue(false)
    const keys = storage.loadKeys()
    expect(keys).toEqual({})
  })

  it('loadKeys parses and returns JSON if file exists', () => {
    vi.mocked(fs.existsSync).mockReturnValue(true)
    vi.mocked(fs.readFileSync).mockReturnValue(JSON.stringify({ gemini: 'test-key' }))
    const keys = storage.loadKeys()
    expect(keys.gemini).toBe('test-key')
  })

  it('saveKeys creates directory and writes file', () => {
    vi.mocked(fs.existsSync).mockReturnValue(false)
    storage.saveKeys({ gemini: 'new-key' })
    
    expect(vi.mocked(fs.mkdirSync)).toHaveBeenCalledWith(expect.stringContaining('userData'), { recursive: true })
    expect(vi.mocked(fs.writeFileSync)).toHaveBeenCalled()
    const writeArgs = vi.mocked(fs.writeFileSync).mock.calls[0]
    expect(writeArgs[0]).toContain('provider_keys.json')
    expect(writeArgs[1]).toContain('new-key')
  })
})
