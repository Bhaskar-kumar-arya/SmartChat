import { describe, it, expect, vi, beforeEach } from 'vitest'
import { APIConfigProvider } from '../../../services/apiServer/APIConfigProvider'
import fs from 'fs'

vi.mock('fs', () => ({
  default: {
    existsSync: vi.fn(),
    readFileSync: vi.fn(),
    writeFileSync: vi.fn()
  }
}))

describe('APIConfigProvider', () => {
  let provider: APIConfigProvider
  
  beforeEach(() => {
    vi.clearAllMocks()
    provider = new APIConfigProvider('/mock/userData')
    delete process.env.SMARTCHAT_API_PORT
  })

  it('should generate a new config if none exists', () => {
    vi.mocked(fs.existsSync).mockReturnValue(false)

    const config = provider.loadOrCreateConfig()

    expect(config.port).toBe(3003)
    expect(config.token).toContain('smartchat_')
    expect(fs.writeFileSync).toHaveBeenCalledWith(
      expect.stringContaining('ai_preferences.json'),
      expect.stringContaining('"externalApiPort": 3003'),
      'utf-8'
    )
  })

  it('should load existing config', () => {
    vi.mocked(fs.existsSync).mockReturnValue(true)
    vi.mocked(fs.readFileSync).mockReturnValue(JSON.stringify({
      externalApiPort: 8080,
      externalApiToken: 'existing_token'
    }))

    const config = provider.loadOrCreateConfig()

    expect(config.port).toBe(8080)
    expect(config.token).toBe('existing_token')
    expect(fs.writeFileSync).not.toHaveBeenCalled()
  })

  it('should override port with environment variable', () => {
    vi.mocked(fs.existsSync).mockReturnValue(true)
    vi.mocked(fs.readFileSync).mockReturnValue(JSON.stringify({
      externalApiPort: 8080,
      externalApiToken: 'existing_token'
    }))

    process.env.SMARTCHAT_API_PORT = '9090'

    const config = provider.loadOrCreateConfig()

    expect(config.port).toBe(9090)
    expect(config.token).toBe('existing_token')
  })
})
