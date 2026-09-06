import { describe, it, expect, vi } from 'vitest'
import { GroqProvider } from '../../../services/ai/providers/GroqProvider'
import { MistralProvider } from '../../../services/ai/providers/MistralProvider'
import { DeepSeekProvider } from '../../../services/ai/providers/DeepSeekProvider'

/**
 * S6-02: app history uses role 'ai' for assistant turns. Groq/Mistral/DeepSeek
 * previously only recognised 'model'/'assistant', so every prior assistant turn
 * was sent to the model as a `user` message, destroying multi-turn structure.
 */
const keyService = { getKey: vi.fn().mockReturnValue('test-key') } as any
const toolRegistry = { getAllTools: vi.fn().mockReturnValue([]) } as any

const history = [
  { role: 'user', content: 'hi' },
  { role: 'ai', content: 'hello there' },
]

describe('provider history role mapping (S6-02)', () => {
  it('GroqProvider maps role "ai" to assistant', () => {
    const p = new GroqProvider(keyService, toolRegistry) as any
    const msgs = p.formatMessages('next', history, '')
    expect(msgs.find((m: any) => m.content === 'hello there').role).toBe('assistant')
  })

  it('MistralProvider maps role "ai" to assistant', () => {
    const p = new MistralProvider(keyService, toolRegistry) as any
    const msgs = p.formatMessages('next', history, '')
    expect(msgs.find((m: any) => m.content === 'hello there').role).toBe('assistant')
  })

  it('DeepSeekProvider maps role "ai" to assistant', () => {
    const p = new DeepSeekProvider(keyService, toolRegistry) as any
    const msgs = p.formatMessages('next', history, '')
    expect(msgs.find((m: any) => m.content === 'hello there').role).toBe('assistant')
  })
})
