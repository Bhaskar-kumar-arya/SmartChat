import { describe, it, expect, vi, beforeEach, Mocked } from 'vitest'
import { APIServer } from '../../../services/apiServer/APIServer'
import { IAPIConfigProvider } from '../../../services/apiServer/IAPIConfigProvider'
import { IToolRegistry } from '../../../services/ai/IToolRegistry'
import { IChatService } from '../../../services/chats/IChatService'
import { IMessageActionService } from '../../../services/messages/IMessageActionService'
import http from 'http'


vi.mock('http', () => {
  const listen = vi.fn()
  const close = vi.fn((cb) => cb())
  return {
    default: {
      createServer: vi.fn(() => ({
        listen,
        close
      }))
    }
  }
})

describe('APIServer', () => {
  let mockConfigProvider: Mocked<IAPIConfigProvider>
  let mockToolRegistry: Mocked<IToolRegistry>
  let mockChatService: Mocked<IChatService>
  let mockMessageActionService: Mocked<IMessageActionService>
  let mockGetSock: any
  let server: APIServer

  beforeEach(() => {
    mockConfigProvider = {
      loadOrCreateConfig: vi.fn().mockReturnValue({ port: 3003, token: 'test_token' })
    } as any

    mockToolRegistry = {
      getToolDefinitions: vi.fn().mockReturnValue([])
    } as any

    mockChatService = {} as any
    mockMessageActionService = {} as any
    mockGetSock = vi.fn() as any

    vi.clearAllMocks()
    server = new APIServer(
      mockConfigProvider,
      mockToolRegistry,
      mockChatService,
      mockMessageActionService,
      mockGetSock as any
    )
  })

  it('should initialize with config', () => {
    expect(mockConfigProvider.loadOrCreateConfig).toHaveBeenCalled()
    expect(server.getPort()).toBe(3003)
    expect(server.getApiToken()).toBe('test_token')
  })

  it('should start and stop the server', async () => {
    server.start()
    expect(http.createServer).toHaveBeenCalled()
    
    const serverInstance = vi.mocked(http.createServer).mock.results[0].value
    expect(serverInstance.listen).toHaveBeenCalledWith(3003, '127.0.0.1', expect.any(Function))

    await server.stop()
    expect(serverInstance.close).toHaveBeenCalled()
  })

  it('should not start multiple times', () => {
    server.start()
    server.start()
    expect(http.createServer).toHaveBeenCalledTimes(1)
  })
})
