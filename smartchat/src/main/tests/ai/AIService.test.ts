import { describe, it, expect, vi, beforeEach } from 'vitest'
import { AIService } from '../../services/ai/AIService'

describe('AIService - generateResponseWithTools', () => {
  let aiService: AIService
  let mockAiKeyService: any
  let mockContactService: any
  let mockToolRegistry: any
  let mockMentionEnricher: any
  let mockGeminiProvider: any

  beforeEach(() => {
    mockAiKeyService = {
      getKey: vi.fn().mockReturnValue('fake-key'),
      getKeys: vi.fn().mockReturnValue({})
    }
    mockContactService = {
      getUserDetails: vi.fn().mockResolvedValue(null)
    }
    mockToolRegistry = {
      getSystemInstructions: vi.fn().mockReturnValue('system instructions'),
      getTool: vi.fn(),
      getAllTools: vi.fn().mockReturnValue([])
    }
    mockMentionEnricher = {
      enrichMentionsInline: vi.fn().mockImplementation((prompt) => Promise.resolve(prompt))
    }

    aiService = new AIService(
      mockAiKeyService,
      mockContactService,
      mockToolRegistry,
      mockMentionEnricher
    )

    // Override contact detail helper
    ;(aiService as any).getUserDetails = vi.fn().mockResolvedValue(null)

    mockGeminiProvider = {
      canHandleModel: vi.fn().mockImplementation((modelId) => modelId.startsWith('gemini:')),
      generateResponse: vi.fn(),
      cleanup: vi.fn().mockResolvedValue(undefined)
    }

    ;(aiService as any).providers['gemini'] = mockGeminiProvider
  })

  it('should return direct response if no tool call tag is present', async () => {
    mockGeminiProvider.generateResponse.mockResolvedValue('Hello conversational response')

    const response = await aiService.generateResponseWithTools('Hi')

    expect(response).toBe('Hello conversational response')
    expect(mockGeminiProvider.generateResponse).toHaveBeenCalledTimes(1)
  })

  it('should execute tool call and loop until conversational response', async () => {
    const mockTool = {
      name: 'queryDatabase',
      execute: vi.fn().mockResolvedValue({ text: 'Tool Executed Successfully' })
    }
    mockToolRegistry.getTool.mockReturnValue(mockTool)

    mockGeminiProvider.generateResponse
      .mockResolvedValueOnce('<thought>Need to call tool</thought><tool_call>{"tool": "queryDatabase", "arguments": {"sql": "SELECT 1"}}</tool_call>')
      .mockResolvedValueOnce('Conversational Final Response')

    const response = await aiService.generateResponseWithTools('Run SQL')

    expect(response).toBe('Conversational Final Response')
    expect(mockGeminiProvider.generateResponse).toHaveBeenCalledTimes(2)
    expect(mockToolRegistry.getTool).toHaveBeenCalledWith('queryDatabase')
    expect(mockTool.execute).toHaveBeenCalledWith({ sql: 'SELECT 1' })
  })
})
