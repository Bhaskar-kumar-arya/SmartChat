import { describe, it, expect, vi, beforeEach, Mocked } from 'vitest'
import { WASocketFactory } from '../../../services/whatsapp/WASocketFactory'
import { IMessageReadRepository } from '../../../services/messages/IMessageQueryRepository'
import makeWASocketImport, { fetchLatestBaileysVersion, AuthenticationState } from '@whiskeysockets/baileys'

vi.mock('@whiskeysockets/baileys', async () => {
  const actual = await vi.importActual('@whiskeysockets/baileys') as any
  return {
    ...actual,
    default: vi.fn().mockReturnValue({}),
    fetchLatestBaileysVersion: vi.fn().mockResolvedValue({ version: [2, 3000, 1015] })
  }
})

describe('WASocketFactory', () => {
  let mockMessageQueryRepo: Mocked<IMessageReadRepository>
  let factory: WASocketFactory

  beforeEach(() => {
    mockMessageQueryRepo = {
      findMessageById: vi.fn()
    } as any

    factory = new WASocketFactory(mockMessageQueryRepo)
    vi.clearAllMocks()
  })

  it('fetchVersion should return version from Baileys', async () => {
    const version = await factory.fetchVersion()
    expect(version).toEqual([2, 3000, 1015])
    expect(fetchLatestBaileysVersion).toHaveBeenCalled()
  })

  it('createSocket should initialize Baileys socket', () => {
    const state: AuthenticationState = { creds: {} as any, keys: {} as any }
    const socket = factory.createSocket([2, 3000, 1015], state, true, true)
    
    expect(makeWASocketImport).toHaveBeenCalledWith(expect.objectContaining({
      version: [2, 3000, 1015],
      auth: state,
      printQRInTerminal: false,
      generateHighQualityLinkPreview: true,
      syncFullHistory: true
    }))
    expect(socket).toBeDefined()
  })
})
