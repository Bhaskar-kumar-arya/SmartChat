import { describe, it, expect } from 'vitest'
import { ReactProtocolStrategy } from '../../../services/ai/prompts/ReactProtocolStrategy'

describe('ReactProtocolStrategy', () => {
  it('should return the correct protocol block string', () => {
    const strategy = new ReactProtocolStrategy()
    const block = strategy.getProtocolBlock()
    
    expect(block).toContain('# RESPONSE PROTOCOL')
    expect(block).toContain('CRITICAL TOOL RULES:')
    expect(block).toContain('<thought>')
    expect(block).toContain('<tool_call>')
    expect(block).not.toBeNull()
    expect(typeof block).toBe('string')
    expect(block.length).toBeGreaterThan(100)
  })
})
