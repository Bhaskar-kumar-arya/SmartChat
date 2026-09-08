import { describe, it, expect, vi } from 'vitest'
import { GroqProvider } from '../../../services/ai/providers/GroqProvider'
import { MistralProvider } from '../../../services/ai/providers/MistralProvider'
import { DeepSeekProvider } from '../../../services/ai/providers/DeepSeekProvider'

/**
 * S6-06: streaming tool-call reassembly keyed on `toolCallDelta.index`. An
 * OpenAI-compatible endpoint that omits `index` on the deltas made `idx`
 * undefined, so fragments landed on toolCalls["undefined"] and the final array
 * iteration dropped the tool call — the request "worked" un-streamed and
 * silently lost the tool call when streamed.
 */
function streamOf(chunks: unknown[]) {
  return {
    async *[Symbol.asyncIterator]() {
      for (const c of chunks) yield c
    }
  }
}

// Two deltas for a single tool call, neither carrying `index`.
const indexlessChunks = [
  { choices: [{ delta: { tool_calls: [{ id: 'call_a', type: 'function', function: { name: 'readMessages', arguments: '{"chat"' } }] } }] },
  { choices: [{ delta: { tool_calls: [{ function: { arguments: ':"x"}' } }] } }] }
]

const keyService = { getKey: vi.fn().mockReturnValue('test-key') } as any
const toolRegistry = { getAllTools: vi.fn().mockReturnValue([]) } as any

const cases: Array<[string, () => any]> = [
  ['GroqProvider', () => new GroqProvider(keyService, toolRegistry)],
  ['MistralProvider', () => new MistralProvider(keyService, toolRegistry)],
  ['DeepSeekProvider', () => new DeepSeekProvider(keyService, toolRegistry)]
]

describe('streaming tool-call reassembly without delta.index (S6-06)', () => {
  for (const [name, make] of cases) {
    it(`${name} still emits the tool call when deltas omit index`, async () => {
      const provider = make()
      provider.client = {
        chat: { completions: { create: vi.fn().mockResolvedValue(streamOf(indexlessChunks)) } }
      }

      const chunks: string[] = []
      await provider.generateResponseStream('go', [], { model: 'x:model' }, (c: string) => chunks.push(c))

      const joined = chunks.join('')
      expect(joined).toContain('<tool_call>')
      expect(joined).toContain('"tool": "readMessages"')
      expect(joined).toContain('"chat": "x"')
    })
  }
})
