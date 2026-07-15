import { describe, it, expect, vi, beforeEach } from 'vitest'
import { ToolRegistry } from '../../../services/ai/AIToolService'
import { ISystemPromptBuilder } from '../../../services/ai/ISystemPromptBuilder'
import { AITool } from '../../../services/ai/IToolRegistry'

describe('ToolRegistry', () => {
  let mockPromptBuilder: ISystemPromptBuilder
  let registry: ToolRegistry

  beforeEach(() => {
    mockPromptBuilder = {
      build: vi.fn().mockReturnValue('SYSTEM_PROMPT')
    } as any

    registry = new ToolRegistry(mockPromptBuilder)
    vi.clearAllMocks()
  })

  it('should register and retrieve a tool', () => {
    const tool: AITool = {
      name: 'test_tool',
      description: 'A test tool',
      parametersSchema: { type: 'object', properties: {} },
      requiresPermission: false,
      execute: vi.fn()
    }

    registry.registerTool(tool)

    expect(registry.getTool('test_tool')).toBe(tool)
    expect(registry.getTool('unknown_tool')).toBeUndefined()
  })

  it('should return all registered tools', () => {
    const tool1: AITool = { name: 'tool1', description: 'desc1', parametersSchema: { type: 'object', properties: {} }, requiresPermission: false, execute: vi.fn() }
    const tool2: AITool = { name: 'tool2', description: 'desc2', parametersSchema: { type: 'object', properties: {} }, requiresPermission: false, execute: vi.fn() }

    registry.registerTool(tool1)
    registry.registerTool(tool2)

    const allTools = registry.getAllTools()
    expect(allTools).toHaveLength(2)
    expect(allTools).toContain(tool1)
    expect(allTools).toContain(tool2)
  })

  it('should return tool definitions', () => {
    const tool: AITool = {
      name: 'test_tool',
      description: 'A test tool',
      parametersSchema: { type: 'object', properties: {} },
      requiresPermission: false,
      execute: vi.fn()
    }

    registry.registerTool(tool)

    const definitions = registry.getToolDefinitions()
    expect(definitions).toHaveLength(1)
    expect(definitions[0]).toEqual({
      name: 'test_tool',
      description: 'A test tool',
      parameters: { type: 'object', properties: {} }
    })
  })

  it('should return empty string for system instructions if no tools registered', () => {
    const instructions = registry.getSystemInstructions()
    expect(instructions).toBe('')
    expect(mockPromptBuilder.build).not.toHaveBeenCalled()
  })

  it('should build system instructions using think mode by default', () => {
    const tool: AITool = { name: 'tool', description: 'desc', parametersSchema: { type: 'object', properties: {} }, requiresPermission: false, execute: vi.fn() }
    registry.registerTool(tool)

    const instructions = registry.getSystemInstructions()

    expect(instructions).toBe('SYSTEM_PROMPT')
    expect(mockPromptBuilder.build).toHaveBeenCalledWith([tool], 'react', undefined)
  })

  it('should build system instructions using standard mode when useThinkMode is false', () => {
    const tool: AITool = { name: 'tool', description: 'desc', parametersSchema: { type: 'object', properties: {} }, requiresPermission: false, execute: vi.fn() }
    registry.registerTool(tool)

    const userDetails = { phoneNumber: '123', lid: '', phoneJid: '', linkedJid: '' }
    const instructions = registry.getSystemInstructions(false, userDetails)

    expect(instructions).toBe('SYSTEM_PROMPT')
    expect(mockPromptBuilder.build).toHaveBeenCalledWith([tool], 'standard', userDetails)
  })
})
