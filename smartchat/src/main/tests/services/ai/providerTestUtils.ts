import { vi } from 'vitest'
import { GroqProvider } from '../../../services/ai/providers/GroqProvider'
import { MistralProvider } from '../../../services/ai/providers/MistralProvider'
import { DeepSeekProvider } from '../../../services/ai/providers/DeepSeekProvider'
import { GeminiProvider } from '../../../services/ai/providers/GeminiProvider'

/**
 * Shared helpers for AI provider characterization tests (N-09 / R-AI-03 safety net).
 * Test-only: fakes the streaming SDK clients so role mapping and tool-call
 * reassembly can be exercised identically across providers.
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type AnyProvider = any

export const keyService = { getKey: vi.fn().mockReturnValue('test-key') } as never
export const toolRegistry = { getAllTools: vi.fn().mockReturnValue([]) } as never

/** Async-iterable stand-in for an SDK stream. */
export function streamOf<T>(chunks: T[]): AsyncIterable<T> {
  return {
    async *[Symbol.asyncIterator]() {
      for (const c of chunks) yield c
    }
  }
}

export interface OpenAICompatCase {
  name: string
  make: () => AnyProvider
}

/** Groq / Mistral / DeepSeek share the OpenAI chat-completions shape. */
export const openAICompatProviders: OpenAICompatCase[] = [
  { name: 'GroqProvider', make: () => new GroqProvider(keyService, toolRegistry) },
  { name: 'MistralProvider', make: () => new MistralProvider(keyService, toolRegistry) },
  { name: 'DeepSeekProvider', make: () => new DeepSeekProvider(keyService, toolRegistry) }
]

export interface ToolDelta {
  index?: number
  id?: string
  name?: string
  args?: string
}

/** Build an OpenAI-style streaming chunk. */
export function chunk(opts: { content?: string; tools?: ToolDelta[] }): unknown {
  const delta: Record<string, unknown> = {}
  if (opts.content !== undefined) delta.content = opts.content
  if (opts.tools) {
    delta.tool_calls = opts.tools.map(t => {
      const d: Record<string, unknown> = {}
      if (t.index !== undefined) d.index = t.index
      if (t.id) d.id = t.id
      if (t.id) d.type = 'function'
      if (t.name !== undefined || t.args !== undefined) {
        d.function = {
          ...(t.name !== undefined ? { name: t.name } : {}),
          ...(t.args !== undefined ? { arguments: t.args } : {})
        }
      }
      return d
    })
  }
  return { choices: [{ delta }] }
}

export interface FakeOpenAIClient {
  create: ReturnType<typeof vi.fn>
}

/** Install a fake streaming client on an OpenAI-compatible provider; returns the `create` spy. */
export function installFakeOpenAIStream(provider: AnyProvider, chunks: unknown[]): FakeOpenAIClient {
  const create = vi.fn().mockResolvedValue(streamOf(chunks))
  provider.client = { chat: { completions: { create } } }
  return { create }
}

/** Run a stream and return every emitted chunk. */
export async function collectStream(
  provider: AnyProvider,
  chunks: unknown[],
  opts: { prompt?: string; history?: Array<{ role: string; content: string; isSystem?: boolean }>; options?: Record<string, unknown> } = {}
): Promise<{ emitted: string[]; text: string; create: ReturnType<typeof vi.fn> }> {
  const { create } = installFakeOpenAIStream(provider, chunks)
  const emitted: string[] = []
  await provider.generateResponseStream(
    opts.prompt ?? 'go',
    opts.history ?? [],
    { model: 'x:model', ...(opts.options ?? {}) },
    (c: string) => emitted.push(c)
  )
  return { emitted, text: emitted.join(''), create }
}

/** Parse every `<tool_call>` JSON block out of reassembled text. */
export function parseToolCalls(text: string): Array<{ tool: string; arguments: Record<string, unknown> }> {
  const out: Array<{ tool: string; arguments: Record<string, unknown> }> = []
  const re = /<tool_call>\s*([\s\S]*?)\s*<\/tool_call>/g
  let m: RegExpExecArray | null
  while ((m = re.exec(text)) !== null) out.push(JSON.parse(m[1]))
  return out
}

/** The `messages` array a fake OpenAI-compat client was called with. */
export function sentMessages(create: ReturnType<typeof vi.fn>): Array<{ role: string; content: string }> {
  return create.mock.calls[0][0].messages
}

// ---- Gemini ----

export interface FakeGemini {
  provider: AnyProvider
  generateContentStream: ReturnType<typeof vi.fn>
  generateContent: ReturnType<typeof vi.fn>
}

export function makeGemini(streamChunks: Array<{ text?: string }> = [{ text: 'ok' }]): FakeGemini {
  const provider = new GeminiProvider(keyService, toolRegistry) as AnyProvider
  const generateContentStream = vi.fn().mockResolvedValue(streamOf(streamChunks))
  const generateContent = vi.fn().mockResolvedValue({ text: 'ok' })
  provider.ai = { models: { generateContentStream, generateContent } }
  return { provider, generateContentStream, generateContent }
}

export type GeminiContent = { role: string; parts: Array<{ text: string }> }
