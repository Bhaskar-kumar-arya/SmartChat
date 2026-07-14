import { describe, it, expect } from 'vitest'
import { createMessageFormatterRegistry } from '../../../services/messages/formatters'
import { MessageFormatterRegistry } from '../../../services/messages/formatters/MessageFormatterRegistry'

describe('createMessageFormatterRegistry', () => {
  it('should return a valid MessageFormatterRegistry with formatters registered', () => {
    const registry = createMessageFormatterRegistry()
    
    expect(registry).toBeInstanceOf(MessageFormatterRegistry)
    
    // Test that formatters are registered by checking output for a known message type
    const result = registry.format(
      { conversation: 'hello world' },
      { messageType: 'conversation', textContent: 'hello world', isDeleted: false },
      'transcript'
    )
    
    expect(result).toBe('hello world')
  })

  it('should format deleted messages', () => {
    const registry = createMessageFormatterRegistry()
    
    const result = registry.format(
      null,
      { messageType: 'conversation', textContent: null, isDeleted: true },
      'transcript'
    )
    
    expect(result).toBe('(Message deleted)')
  })
})
