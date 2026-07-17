import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { SystemPromptBuilder } from '../../../services/ai/SystemPromptBuilder'
import { IProtocolStrategy } from '../../../services/ai/prompts/IProtocolStrategy'
import { AITool } from '../../../services/ai/IToolRegistry'
import * as ToolFormatter from '../../../services/ai/prompts/ToolDefinitionFormatter'

vi.mock('../../../services/ai/prompts/ToolDefinitionFormatter', () => ({
  formatTools: vi.fn()
}))

describe('SystemPromptBuilder', () => {
  let mockReactStrategy: IProtocolStrategy
  let mockStandardStrategy: IProtocolStrategy
  let builder: SystemPromptBuilder

  beforeEach(() => {
    mockReactStrategy = {
      getProtocolBlock: vi.fn().mockReturnValue('REACT PROTOCOL BLOCK')
    } as any

    mockStandardStrategy = {
      getProtocolBlock: vi.fn().mockReturnValue('STANDARD PROTOCOL BLOCK')
    } as any

    builder = new SystemPromptBuilder(mockReactStrategy, mockStandardStrategy)

    vi.clearAllMocks()
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-07-15T10:00:00Z'))
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('should format react strategy prompt with tools and user details', () => {
    const tools: AITool[] = [{
      name: 'test_tool',
      description: 'A test tool',
      parametersSchema: { type: 'object', properties: {} },
      requiresPermission: false,
      execute: vi.fn() as any
    } as AITool]

    vi.mocked(ToolFormatter.formatTools).mockReturnValue('FORMATTED TOOLS')

    const result = builder.build(tools, 'react', {
      phoneNumber: '12345',
      lid: 'lid_123',
      phoneJid: 'phone@s.whatsapp.net',
      linkedJid: 'linked@lid'
    })

    expect(ToolFormatter.formatTools).toHaveBeenCalledWith(tools)
    expect(mockReactStrategy.getProtocolBlock).toHaveBeenCalled()
    expect(mockStandardStrategy.getProtocolBlock).not.toHaveBeenCalled()
    
    // Check if the formatted sections are present
    expect(result).toContain('FORMATTED TOOLS')
    expect(result).toContain('REACT PROTOCOL BLOCK')
    expect(result).toContain('12345')
    expect(result).toContain('lid_123')
    expect(result).toContain('phone@s.whatsapp.net')
    expect(result).toContain('linked@lid')
    expect(result).not.toContain('CITATION GUIDELINES')
  })

  it('should include citation instructions when a tool supports citations', () => {
    const tools: AITool[] = [{
      name: 'test_tool',
      description: 'A test tool',
      parametersSchema: { type: 'object', properties: {} },
      requiresPermission: false,
      supportsCitations: true,
      execute: vi.fn() as any
    }]
    const result = builder.build(tools, 'standard')
    
    expect(result).toContain('CITING SOURCES IN YOUR RESPONSE')
    expect(result).toContain('[](cite:N)')
  })

  it('should format standard strategy prompt without user details', () => {
    vi.mocked(ToolFormatter.formatTools).mockReturnValue('FORMATTED TOOLS')

    const result = builder.build([], 'standard')

    expect(ToolFormatter.formatTools).toHaveBeenCalledWith([])
    expect(mockStandardStrategy.getProtocolBlock).toHaveBeenCalled()
    expect(mockReactStrategy.getProtocolBlock).not.toHaveBeenCalled()

    expect(result).toContain('FORMATTED TOOLS')
    expect(result).toContain('STANDARD PROTOCOL BLOCK')
    expect(result).toContain('Phone Number: \n') // empty string
  })
})
