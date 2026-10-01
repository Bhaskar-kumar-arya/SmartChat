import { describe, it, expect } from 'vitest'
import { openAICompatProviders, collectStream, chunk, parseToolCalls, makeGemini } from './providerTestUtils'

/**
 * S6-06: streaming tool-call reassembly keyed on `toolCallDelta.index`. An
 * OpenAI-compatible endpoint that omits `index` on the deltas made `idx`
 * undefined, so fragments landed on toolCalls["undefined"] and the final array
 * iteration dropped the tool call — the request "worked" un-streamed and
 * silently lost the tool call when streamed.
 *
 * N-09: broadened through the shared util (text, multiple calls, index-based,
 * malformed args) plus Gemini text-stream reassembly.
 */
const indexlessChunks = [
  chunk({ tools: [{ id: 'call_a', name: 'readMessages', args: '{"chat"' }] }),
  chunk({ tools: [{ args: ':"x"}' }] })
]

describe('streaming tool-call reassembly', () => {
  for (const { name, make } of openAICompatProviders) {
    describe(name, () => {
      it('still emits the tool call when deltas omit index (S6-06)', async () => {
        const { text } = await collectStream(make(), indexlessChunks)
        expect(text).toContain('<tool_call>')
        expect(text).toContain('"tool": "readMessages"')
        expect(text).toContain('"chat": "x"')
      })

      it('reassembles a single index-keyed call split across deltas (name and args fragments)', async () => {
        const { text } = await collectStream(make(), [
          chunk({ tools: [{ index: 0, id: 'c1', name: 'read', args: '' }] }),
          chunk({ tools: [{ index: 0, name: 'Messages' }] }),
          chunk({ tools: [{ index: 0, args: '{"a":' }] }),
          chunk({ tools: [{ index: 0, args: '1}' }] })
        ])
        expect(parseToolCalls(text)).toEqual([{ tool: 'readMessages', arguments: { a: 1 } }])
      })

      it('keeps interleaved parallel calls separate by index', async () => {
        const { text } = await collectStream(make(), [
          chunk({ tools: [{ index: 0, id: 'c1', name: 'one', args: '{"x":' }] }),
          chunk({ tools: [{ index: 1, id: 'c2', name: 'two', args: '{"y":' }] }),
          chunk({ tools: [{ index: 0, args: '1}' }] }),
          chunk({ tools: [{ index: 1, args: '2}' }] })
        ])
        expect(parseToolCalls(text)).toEqual([
          { tool: 'one', arguments: { x: 1 } },
          { tool: 'two', arguments: { y: 2 } }
        ])
      })

      it('separates index-less calls that carry distinct ids', async () => {
        const { text } = await collectStream(make(), [
          chunk({ tools: [{ id: 'c1', name: 'one', args: '{"x":1}' }] }),
          chunk({ tools: [{ id: 'c2', name: 'two', args: '{"y":2}' }] })
        ])
        expect(parseToolCalls(text)).toEqual([
          { tool: 'one', arguments: { x: 1 } },
          { tool: 'two', arguments: { y: 2 } }
        ])
      })

      it('streams text deltas live and emits tool-call XML only after the stream ends', async () => {
        const { emitted } = await collectStream(make(), [
          chunk({ content: 'Let me ' }),
          chunk({ tools: [{ index: 0, id: 'c1', name: 'one', args: '{}' }] }),
          chunk({ content: 'check.' })
        ])
        expect(emitted.slice(0, 2)).toEqual(['Let me ', 'check.'])
        expect(emitted).toHaveLength(3)
        expect(emitted[2]).toContain('<tool_call>')
      })

      it('emits no tool XML for a text-only stream', async () => {
        const { text } = await collectStream(make(), [chunk({ content: 'hel' }), chunk({ content: 'lo' })])
        expect(text).toBe('hello')
      })

      it('degrades malformed argument JSON to empty arguments instead of throwing', async () => {
        const { text } = await collectStream(make(), [
          chunk({ tools: [{ index: 0, id: 'c1', name: 'one', args: '{"bad' }] })
        ])
        expect(parseToolCalls(text)).toEqual([{ tool: 'one', arguments: {} }])
      })

      it('drops nameless tool-call fragments', async () => {
        const { text } = await collectStream(make(), [chunk({ tools: [{ index: 0, id: 'c1', args: '{}' }] })])
        expect(text).toBe('')
      })
    })
  }

  describe('GeminiProvider (text-only streaming)', () => {
    it('forwards each non-empty chunk in order and skips empty ones', async () => {
      const g = makeGemini([{ text: 'a' }, { text: '' }, {}, { text: 'b' }])
      const out: string[] = []
      await g.provider.generateResponseStream('p', [], { model: 'gemini:m' }, (c: string) => out.push(c))
      expect(out).toEqual(['a', 'b'])
    })

    it('strips the gemini: prefix from the model id', async () => {
      const g = makeGemini()
      await g.provider.generateResponseStream('p', [], { model: 'gemini:some-model' }, () => undefined)
      expect(g.generateContentStream.mock.calls[0][0].model).toBe('some-model')
    })

    it('stops emitting once the signal is aborted', async () => {
      const g = makeGemini([{ text: 'a' }, { text: 'b' }])
      const ac = new AbortController()
      const out: string[] = []
      await g.provider.generateResponseStream('p', [], { model: 'gemini:m' }, (c: string) => {
        out.push(c)
        ac.abort()
      }, ac.signal)
      expect(out).toEqual(['a'])
    })
  })
})
