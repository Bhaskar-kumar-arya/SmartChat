import { describe, it, expect, vi } from 'vitest'
import { openAICompatProviders, collectStream, chunk, parseToolCalls, type AnyProvider } from './providerTestUtils'
import { DeepSeekProvider } from '../../../services/ai/providers/DeepSeekProvider'
import { keyService, toolRegistry } from './providerTestUtils'

/**
 * R-AI-03 safety net: model listing / fallback / filtering / default-model routing
 * for the OpenAI-compatible providers, plus DeepSeek reasoning and tool-XML emission.
 * Must pass identically before and after extracting BaseOpenAICompatibleProvider.
 */
const expectations: Record<
  string,
  { prefix: string; defaultModel: string; top: string; excluded: string; fallbackIds: string[] }
> = {
  GroqProvider: {
    prefix: 'groq',
    defaultModel: 'openai/gpt-oss-120b',
    top: 'groq:openai/gpt-oss-120b',
    excluded: 'whisper-large',
    fallbackIds: ['groq:openai/gpt-oss-120b', 'groq:llama-3.3-70b-versatile', 'groq:llama-3.1-8b-instant', 'groq:mixtral-8x7b-32768']
  },
  MistralProvider: {
    prefix: 'mistral',
    defaultModel: 'mistral-large-latest',
    top: 'mistral:mistral-large-latest',
    excluded: 'mistral-embed',
    fallbackIds: ['mistral:mistral-large-latest', 'mistral:codestral-2508', 'mistral:pixtral-12b-2409']
  },
  DeepSeekProvider: {
    prefix: 'deepseek',
    defaultModel: 'deepseek-v4-pro',
    top: 'deepseek:deepseek-v4-pro',
    excluded: 'deepseek-embed',
    fallbackIds: ['deepseek:deepseek-v4-pro', 'deepseek:deepseek-v4-flash', 'deepseek:deepseek-chat', 'deepseek:deepseek-reasoner']
  }
}

function withModels(p: AnyProvider, list: () => Promise<unknown>): void {
  p.client = { models: { list } }
}

describe('OpenAI-compatible providers: model listing and routing', () => {
  for (const { name, make } of openAICompatProviders) {
    const exp = expectations[name]
    describe(name, () => {
      it('routes only its own prefix', () => {
        const p = make() as unknown as { canHandleModel(id: string): boolean }
        expect(p.canHandleModel(`${exp.prefix}:foo`)).toBe(true)
        expect(p.canHandleModel('gemini:foo')).toBe(false)
        expect(p.canHandleModel(exp.prefix)).toBe(false)
      })

      it('lists prefixed models, filters non-chat ones and sorts the flagship first', async () => {
        const p = make()
        withModels(p, async () => ({
          data: [
            { id: 'zzz-model', owned_by: 'o1' },
            { id: exp.excluded, owned_by: 'o2' },
            { id: exp.top.slice(exp.prefix.length + 1), owned_by: 'o3' }
          ]
        }))
        const models = await (p as unknown as { getAvailableModels(): Promise<Array<{ id: string; provider: string; isLocal: boolean; description?: string }>> }).getAvailableModels()
        expect(models.map(m => m.id)).toEqual([exp.top, `${exp.prefix}:zzz-model`])
        expect(models[0]).toMatchObject({ provider: exp.prefix, isLocal: false, description: 'Owned by: o3' })
      })

      it('returns the static fallback list when listing fails', async () => {
        const p = make()
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
        withModels(p, async () => {
          throw new Error('offline')
        })
        const models = await (p as unknown as { getAvailableModels(): Promise<Array<{ id: string }>> }).getAvailableModels()
        expect(models.map(m => m.id)).toEqual(exp.fallbackIds)
        warn.mockRestore()
      })

      it('uses the default model (prefix stripped) when none is given', async () => {
        const { create } = await collectStream(make(), [], { options: { model: undefined } })
        expect(create.mock.calls[0][0].model).toBe(exp.defaultModel)
      })

      it('strips the prefix from an explicit model', async () => {
        const { create } = await collectStream(make(), [], { options: { model: `${exp.prefix}:custom-x` } })
        expect(create.mock.calls[0][0].model).toBe('custom-x')
      })

      it('emits streamed native tool calls as <tool_call> XML after the text', async () => {
        const { emitted, text } = await collectStream(make(), [
          chunk({ content: 'hi ' }),
          chunk({ tools: [{ index: 0, id: 'c1', name: 'search', args: '{"q":' }] }),
          chunk({ tools: [{ index: 0, args: '"x"}' }] })
        ])
        expect(emitted[0]).toBe('hi ')
        expect(parseToolCalls(text)).toEqual([{ tool: 'search', arguments: { q: 'x' } }])
      })

      it('emits non-streaming native tool calls as XML with unparsable args degraded to {}', async () => {
        const p = make()
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
        const create = vi.fn().mockResolvedValue({
          choices: [
            {
              message: {
                content: 'body',
                tool_calls: [
                  { type: 'function', function: { name: 'a', arguments: '{"k":1}' } },
                  { type: 'function', function: { name: 'b', arguments: '{bad' } }
                ]
              }
            }
          ]
        })
        p.client = { chat: { completions: { create } } }
        const out = await p.generateResponse('go', [], { model: 'x:m' })
        expect(out.startsWith('body')).toBe(true)
        expect(parseToolCalls(out)).toEqual([
          { tool: 'a', arguments: { k: 1 } },
          { tool: 'b', arguments: {} }
        ])
        warn.mockRestore()
      })
    })
  }
})

describe('DeepSeekProvider reasoning', () => {
  const make = (): AnyProvider => new DeepSeekProvider(keyService, toolRegistry) as unknown as AnyProvider

  it('wraps streamed reasoning_content in <think> and closes it before the answer', async () => {
    const reasoning = (t: string): unknown => ({ choices: [{ delta: { reasoning_content: t } }] })
    const { text } = await collectStream(make(), [reasoning('a'), reasoning('b'), chunk({ content: 'ans' })])
    expect(text).toBe('<think>\nab\n</think>\n\nans')
  })

  it('closes an unterminated <think> block at end of stream', async () => {
    const { text } = await collectStream(make(), [{ choices: [{ delta: { reasoning_content: 'only' } }] }])
    expect(text).toBe('<think>\nonly\n</think>\n\n')
  })

  it('omits tools and temperature for the reasoner model, keeps them otherwise', async () => {
    const tools = [{ name: 't', description: 'd', parametersSchema: {} }]
    ;(toolRegistry.getAllTools as unknown as ReturnType<typeof vi.fn>).mockReturnValue(tools)
    try {
      const r = await collectStream(make(), [], { options: { model: 'deepseek:deepseek-reasoner' } })
      expect(r.create.mock.calls[0][0].tools).toBeUndefined()
      expect(r.create.mock.calls[0][0].temperature).toBeUndefined()
      const c = await collectStream(make(), [], { options: { model: 'deepseek:deepseek-chat' } })
      expect(c.create.mock.calls[0][0].tools).toHaveLength(1)
      expect(c.create.mock.calls[0][0].temperature).toBe(0)
    } finally {
      ;(toolRegistry.getAllTools as unknown as ReturnType<typeof vi.fn>).mockReturnValue([])
    }
  })

  it('prepends reasoning_content to non-streaming responses', async () => {
    const p = make()
    p.client = {
      chat: { completions: { create: vi.fn().mockResolvedValue({ choices: [{ message: { content: 'ans', reasoning_content: 'why' } }] }) } }
    }
    expect(await p.generateResponse('go', [], { model: 'deepseek:deepseek-chat' })).toBe('<think>\nwhy\n</think>\n\nans')
  })
})
