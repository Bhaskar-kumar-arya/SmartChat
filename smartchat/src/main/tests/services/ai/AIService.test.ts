import { describe, it, expect, vi, beforeEach, Mocked } from 'vitest'
import { AIService } from '../../../services/ai/AIService'
import { IAIKeyService } from '../../../services/ai/IAIKeyService'
import { IContactQueryService } from '../../../services/contacts/IContactService'
import { IToolRegistry } from '../../../services/ai/IToolRegistry'
import { ISystemInstructionBuilder } from '../../../services/ai/ISystemInstructionBuilder'
import { IBaseAIProvider } from '../../../services/ai/providers/IBaseAIProvider'
import { IFullResponseProvider } from '../../../services/ai/providers/IFullResponseProvider'

vi.mock('../../../services/ai/providers/GeminiProvider', () => ({ GeminiProvider: vi.fn() }))
vi.mock('../../../services/ai/providers/GroqProvider', () => ({ GroqProvider: vi.fn() }))
vi.mock('../../../services/ai/providers/MistralProvider', () => ({ MistralProvider: vi.fn() }))
vi.mock('../../../services/ai/providers/DeepSeekProvider', () => ({ DeepSeekProvider: vi.fn() }))
vi.mock('../../../services/ai/providers/LMStudioProvider', () => ({ LMStudioProvider: vi.fn() }))

describe('AIService', () => {
  let mockKeyService: Mocked<IAIKeyService>
  let mockContactService: Mocked<IContactQueryService>
  let mockToolRegistry: Mocked<IToolRegistry & ISystemInstructionBuilder>
  let aiService: AIService
  let mockProvider: Mocked<IBaseAIProvider & IFullResponseProvider>

  beforeEach(() => {
    mockKeyService = {
      getKeys: vi.fn().mockReturnValue({ gemini: 'key1' }),
      saveKey: vi.fn(),
      getKey: vi.fn()
    } as any

    mockContactService = {
      getMeJids: vi.fn().mockResolvedValue(['user@s.whatsapp.net', 'user@lid'])
    } as any

    mockToolRegistry = {
      getSystemInstructions: vi.fn().mockReturnValue('SYSTEM_PROMPT'),
      registerTool: vi.fn(),
      getTool: vi.fn(),
      getAllTools: vi.fn(),
      getToolDefinitions: vi.fn()
    } as any

    aiService = new AIService(mockKeyService, mockContactService, mockToolRegistry)

    mockProvider = {
      canHandleModel: vi.fn().mockReturnValue(true),
      generateResponse: vi.fn().mockResolvedValue('RESPONSE'),
      getAvailableModels: vi.fn().mockResolvedValue([{ id: 'mock-model' }]),
      cleanup: vi.fn().mockResolvedValue(undefined)
    } as any

    aiService.registerProvider('mock', mockProvider)
    vi.clearAllMocks()
  })

  it('should return available models from all providers', async () => {
    const models = await aiService.getAvailableModels()
    // It will call getAvailableModels on all default registered providers plus the mock one
    expect(models).toBeDefined()
  })

  it('should set provider key and update instance if possible', () => {
    const success = aiService.setProviderKey('mock', 'new-key')
    expect(success).toBe(true)
    expect(mockKeyService.saveKey).toHaveBeenCalledWith('mock', 'new-key')
  })

  it('should format mentions and chat context correctly in generation', async () => {
    mockProvider.canHandleModel.mockReturnValue(true)
    
    // override getProviderForModel via private method by ensuring mock handles the request
    aiService['providers']['mock'] = mockProvider
    aiService['providerOrder'] = ['mock']

    const response = await aiService.generateResponse('Hello @test', [], [], [{ name: 'test', jid: '123@s.whatsapp.net' }], { model: 'mock-model' })

    expect(response).toBe('RESPONSE')
    expect(mockProvider.generateResponse).toHaveBeenCalledWith(
      expect.stringContaining('Hello 123@s.whatsapp.net'),
      expect.any(Array),
      expect.objectContaining({ systemPrompt: 'SYSTEM_PROMPT' }),
      undefined
    )
  })

  it('should append relevant chat context if not explicitly mentioned in prompt', async () => {
    aiService['providers']['mock'] = mockProvider
    aiService['providerOrder'] = ['mock']

    const contextFiles = [{
      jid: 'chat1@g.us',
      name: 'Group 1',
      messages: [{ participant: 'user1@s.whatsapp.net', textContent: 'Hi', timestamp: '1000', chatJid: 'chat1@g.us' }]
    }]

    await aiService.generateResponse('Summarize', contextFiles, [], [], { model: 'mock-model' })

    expect(mockProvider.generateResponse).toHaveBeenCalledWith(
      expect.stringContaining('RELEVANT CHAT CONTEXT'),
      expect.any(Array),
      expect.any(Object),
      undefined
    )
  })

  it('should pass abort signal if requestId is provided', async () => {
    aiService['providers']['mock'] = mockProvider
    aiService['providerOrder'] = ['mock']

    const promise = aiService.generateResponse('Test', [], [], [], { requestId: 'req-1' })
    aiService.abortResponse('req-1')
    
    await promise

    expect(mockProvider.generateResponse).toHaveBeenCalledWith(
      expect.any(String),
      expect.any(Array),
      expect.any(Object),
      expect.any(AbortSignal)
    )
  })

  it('should handle streaming response', async () => {
    aiService['providers']['mock'] = mockProvider
    aiService['providerOrder'] = ['mock']

    const chunkHandler = vi.fn()
    await aiService.generateResponseStream('Test stream', [], [], [], {}, chunkHandler)

    // Falls back to generateResponse in mock
    expect(chunkHandler).toHaveBeenCalledWith('RESPONSE')
  })
})
