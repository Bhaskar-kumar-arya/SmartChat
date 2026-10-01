import type OpenAI from 'openai'
import { ModelInfo } from './IBaseAIProvider'
import { IApiKeyAwareProvider } from './IApiKeyAwareProvider'
import { IStreamingProvider } from './IStreamingProvider'
import { IFullResponseProvider } from './IFullResponseProvider'
import { IToolRegistry } from '../IToolRegistry'
import { IAIKeyService } from '../IAIKeyService'
import { createLogger } from '../../../utils/logger'

const log = createLogger('ai:openai-compat')

type ChatMessage = { role: 'user' | 'assistant' | 'system'; content: string }

/** Streaming delta, widened with the non-standard `reasoning_content` some endpoints emit. */
export type StreamDelta = OpenAI.Chat.Completions.ChatCompletionChunk.Choice.Delta & {
  reasoning_content?: string
}

/** Per-stream hook for providers that surface native reasoning tokens (e.g. DeepSeek). */
export interface StreamReasoner {
  onDelta(delta: StreamDelta, onChunk: (chunk: string) => void): void
  finish(onChunk: (chunk: string) => void): void
}

/**
 * Shared implementation for providers speaking the OpenAI chat-completions
 * protocol (Groq, Mistral, DeepSeek). Subclasses supply only the prefix,
 * default model, client construction, model filter/fallbacks and optional
 * reasoning hooks.
 */
export abstract class BaseOpenAICompatibleProvider
  implements IStreamingProvider, IFullResponseProvider, IApiKeyAwareProvider
{
  protected client: OpenAI

  /** Model-id prefix used for routing, key lookup and display ids (e.g. `mistral`). */
  protected abstract readonly prefix: string
  protected abstract readonly displayName: string
  protected abstract readonly defaultModel: string
  /** Ids sorted to the top of the model list, in priority order. */
  protected abstract readonly preferredModelIds: string[]

  protected abstract createClient(apiKey: string): OpenAI
  protected abstract includeModel(lowerCasedId: string): boolean
  protected abstract fallbackModels(): ModelInfo[]

  constructor(
    protected readonly aiKeyService: IAIKeyService,
    protected readonly toolRegistry: IToolRegistry,
    keyName: string
  ) {
    this.client = this.createClient(this.aiKeyService.getKey(keyName))
  }

  updateApiKey(apiKey: string): void {
    this.client = this.createClient(apiKey)
  }

  canHandleModel(modelId: string): boolean {
    return modelId.startsWith(`${this.prefix}:`)
  }

  async cleanup(): Promise<void> {
    // No local resources to unload
  }

  // ---- hooks (defaults suit plain OpenAI-compatible endpoints) ----
  protected supportsTools(_rawModel: string): boolean {
    return true
  }
  protected temperatureFor(_rawModel: string): number | undefined {
    return 0.0
  }
  protected decorateResponse(_message: unknown, content: string): string {
    return content
  }
  protected createStreamReasoner(): StreamReasoner | undefined {
    return undefined
  }

  protected formatMessages(
    prompt: string,
    history: Array<{ role: string; content: string }>,
    systemPrompt: string
  ): ChatMessage[] {
    const messages: ChatMessage[] = []
    if (systemPrompt) {
      messages.push({ role: 'system', content: systemPrompt })
    }

    for (const msg of history || []) {
      // App history uses role 'ai' for assistant turns (see IAIChatSessionService);
      // 'model'/'assistant' are also accepted for safety. Anything else -> 'user'.
      const role = msg.role === 'ai' || msg.role === 'model' || msg.role === 'assistant' ? 'assistant' : 'user'
      messages.push({ role, content: msg.content })
    }

    messages.push({ role: 'user', content: prompt })
    return messages
  }

  private getTools(): Array<{
    type: 'function'
    function: { name: string; description: string; parameters: Record<string, unknown> }
  }> {
    return this.toolRegistry.getAllTools().map(t => ({
      type: 'function' as const,
      function: {
        name: t.name,
        description: t.description,
        parameters: t.parametersSchema as Record<string, unknown>
      }
    }))
  }

  private stripPrefix(modelId: string): string {
    const p = `${this.prefix}:`
    return modelId.startsWith(p) ? modelId.slice(p.length) : modelId
  }

  private toolCallXml(name: string, argsObj: unknown): string {
    return `\n<tool_call>\n{\n  "tool": "${name}",\n  "arguments": ${JSON.stringify(argsObj, null, 2)}\n}\n</tool_call>\n`
  }

  private parseArgs(raw: string, streamed: boolean): unknown {
    try {
      return JSON.parse(raw)
    } catch {
      log.warn(`Failed to parse ${this.displayName} ${streamed ? 'streamed ' : ''}tool call arguments:`, raw)
      return {}
    }
  }

  async generateResponse(
    prompt: string,
    history: Array<{ role: string; content: string }>,
    options: { model?: string; [key: string]: unknown },
    signal?: AbortSignal
  ): Promise<string> {
    const modelOption = typeof options?.model === 'string' ? options.model : this.defaultModel
    const rawModel = this.stripPrefix(modelOption)
    const systemPrompt = typeof options?.systemPrompt === 'string' ? options.systemPrompt : ''
    const messages = this.formatMessages(prompt, history, systemPrompt)
    const tools = this.supportsTools(rawModel) ? this.getTools() : []

    const optionsSignal = options?.signal instanceof AbortSignal ? options.signal : undefined
    const actualSignal = optionsSignal || signal

    const response = await this.client.chat.completions.create(
      {
        model: rawModel,
        messages,
        tools: tools.length > 0 ? tools : undefined,
        temperature: this.temperatureFor(rawModel)
      },
      { signal: actualSignal }
    )

    const message = response.choices[0]?.message
    let finalResponse = this.decorateResponse(message, message?.content || '')

    // Convert native tool calls to XML format if present
    if (message?.tool_calls && message.tool_calls.length > 0) {
      for (const tc of message.tool_calls) {
        if (tc.type === 'function' && tc.function.name) {
          finalResponse += this.toolCallXml(tc.function.name, this.parseArgs(tc.function.arguments, false))
        }
      }
    }

    return finalResponse
  }

  async generateResponseStream(
    prompt: string,
    history: Array<{ role: string; content: string }>,
    options: { model?: string; [key: string]: unknown },
    onChunk: (chunk: string) => void,
    signal?: AbortSignal
  ): Promise<void> {
    const modelOption = typeof options?.model === 'string' ? options.model : this.defaultModel
    const rawModel = this.stripPrefix(modelOption)
    const systemPrompt = typeof options?.systemPrompt === 'string' ? options.systemPrompt : ''
    const messages = this.formatMessages(prompt, history, systemPrompt)
    const tools = this.supportsTools(rawModel) ? this.getTools() : []

    const optionsSignal = options?.signal instanceof AbortSignal ? options.signal : undefined
    const actualSignal = optionsSignal || signal

    const stream = await this.client.chat.completions.create(
      {
        model: rawModel,
        messages,
        tools: tools.length > 0 ? tools : undefined,
        temperature: this.temperatureFor(rawModel),
        stream: true
      },
      { signal: actualSignal }
    )

    const toolCalls: Array<{
      id: string
      type: 'function'
      function: { name: string; arguments: string }
    }> = []
    const reasoner = this.createStreamReasoner()

    for await (const chunk of stream) {
      if (actualSignal?.aborted) break

      const delta = chunk.choices[0]?.delta as StreamDelta | undefined
      if (!delta) continue

      reasoner?.onDelta(delta, onChunk)

      if (delta.content) {
        onChunk(delta.content)
      }

      if (delta.tool_calls) {
        for (const toolCallDelta of delta.tool_calls) {
          // Some OpenAI-compatible endpoints omit `index` on tool-call deltas
          // (S6-06). Fall back to matching on id, else append, so the fragment
          // isn't written to toolCalls["undefined"] and dropped by the array
          // iteration below.
          const rawIdx = (toolCallDelta as { index?: number }).index
          let idx: number
          if (typeof rawIdx === 'number') {
            idx = rawIdx
          } else if (toolCallDelta.id) {
            const existing = toolCalls.findIndex(t => t?.id === toolCallDelta.id)
            idx = existing >= 0 ? existing : toolCalls.length
          } else {
            idx = Math.max(0, toolCalls.length - 1)
          }
          if (!toolCalls[idx]) {
            toolCalls[idx] = {
              id: toolCallDelta.id || '',
              type: 'function',
              function: { name: '', arguments: '' }
            }
          }
          if (toolCallDelta.id) {
            toolCalls[idx].id = toolCallDelta.id
          }
          if (toolCallDelta.function?.name) {
            toolCalls[idx].function.name += toolCallDelta.function.name
          }
          if (toolCallDelta.function?.arguments) {
            toolCalls[idx].function.arguments += toolCallDelta.function.arguments
          }
        }
      }
    }

    reasoner?.finish(onChunk)

    // After stream completes, emit accumulated tool calls as XML chunks
    for (const tc of toolCalls) {
      if (tc && tc.function.name) {
        onChunk(this.toolCallXml(tc.function.name, this.parseArgs(tc.function.arguments, true)))
      }
    }
  }

  async getAvailableModels(): Promise<ModelInfo[]> {
    try {
      const list = await this.client.models.list()
      const models: ModelInfo[] = list.data
        .filter(m => this.includeModel(m.id.toLowerCase()))
        .map(m => ({
          id: `${this.prefix}:${m.id}`,
          name: m.id,
          provider: this.prefix,
          description: `Owned by: ${m.owned_by}`,
          isLocal: false
        }))

      models.sort((a, b) => {
        for (const id of this.preferredModelIds) {
          if (a.id === id) return -1
          if (b.id === id) return 1
        }
        return 0
      })
      return models
    } catch (error: unknown) {
      log.warn(`[${this.displayName}Provider] Could not fetch models from ${this.displayName}:`, error)
      return this.fallbackModels()
    }
  }
}
