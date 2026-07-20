import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { LlmCapabilityProvider } from '../../extensions/capabilities/providers/LlmCapabilityProvider'
import { ExtensionManifest } from '../../extensions/types/ExtensionManifest'

describe('LlmCapabilityProvider', () => {
  let mockAiService: any
  let mockAiChatSessionService: any

  beforeEach(() => {
    mockAiService = {
      generateResponseWithTools: vi.fn().mockResolvedValue('Hello from LLM with tools')
    }

    mockAiChatSessionService = {
      getAIOptions: vi.fn().mockResolvedValue({
        model: 'gemini:gemma-4-31b-it',
        useThinkMode: true,
        contextLength: 24576,
        autoSaveChats: true
      })
    }
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('should not inject LLM API if permission is missing', () => {
    const provider = new LlmCapabilityProvider(mockAiService, mockAiChatSessionService)
    const manifest = { permissions: [] } as unknown as ExtensionManifest
    const api = provider.build(manifest, 'test-ext')

    expect(api).toBeUndefined()
  })

  it('should call LLM using settings default if no options specified', async () => {
    const provider = new LlmCapabilityProvider(mockAiService, mockAiChatSessionService)
    const manifest = { permissions: ['llm:chat'] } as unknown as ExtensionManifest
    const api = provider.build(manifest, 'test-ext')

    expect(api).toBeDefined()
    const response = await api!.chat('What is 2+2?')

    expect(response).toBe('Hello from LLM with tools')
    expect(mockAiChatSessionService.getAIOptions).toHaveBeenCalled()
    expect(mockAiService.generateResponseWithTools).toHaveBeenCalledWith(
      'What is 2+2?',
      undefined,
      [],
      undefined,
      {
        model: 'gemini:gemma-4-31b-it',
        useThinkMode: true
      }
    )
  })

  it('should allow overriding model, think mode and mapping history', async () => {
    const provider = new LlmCapabilityProvider(mockAiService, mockAiChatSessionService)
    const manifest = { permissions: ['llm:chat'] } as unknown as ExtensionManifest
    const api = provider.build(manifest, 'test-ext')

    expect(api).toBeDefined()
    const response = await api!.chat('What is 3+3?', {
      model: 'groq:llama3-8b',
      useThinkMode: false,
      history: [
        { role: 'user', content: 'What is 1+1?' },
        { role: 'ai', content: 'It is 2.' },
        { role: 'system', content: 'Instructions' }
      ]
    })

    expect(response).toBe('Hello from LLM with tools')
    expect(mockAiChatSessionService.getAIOptions).toHaveBeenCalled()
    expect(mockAiService.generateResponseWithTools).toHaveBeenCalledWith(
      'What is 3+3?',
      undefined,
      [
        { role: 'user', content: 'What is 1+1?', isSystem: false },
        { role: 'ai', content: 'It is 2.', isSystem: false },
        { role: 'user', content: 'Instructions', isSystem: true }
      ],
      undefined,
      {
        model: 'groq:llama3-8b',
        useThinkMode: false
      }
    )
  })
})
