import { describe, it, expect } from 'vitest'
import { StandardProtocolStrategy } from '../../../services/ai/prompts/StandardProtocolStrategy'

describe('StandardProtocolStrategy', () => {
  it('should return the correct protocol block string', () => {
    const strategy = new StandardProtocolStrategy()
    const block = strategy.getProtocolBlock()
    
    expect(block).toContain('# RESPONSE PROTOCOL')
    expect(block).toContain('CRITICAL TOOL RULES:')
    expect(block).toContain('<|think|>')
    expect(block).toContain('<tool_call>')
    expect(block).not.toBeNull()
    expect(typeof block).toBe('string')
    expect(block.length).toBeGreaterThan(100)
  })
})
