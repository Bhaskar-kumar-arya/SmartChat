import OpenAI from 'openai'
import { ModelInfo } from './IBaseAIProvider'
import { IToolRegistry } from '../IToolRegistry'
import { IAIKeyService } from '../IAIKeyService'
import { BaseOpenAICompatibleProvider, StreamReasoner } from './BaseOpenAICompatibleProvider'

export class DeepSeekProvider extends BaseOpenAICompatibleProvider {
  protected readonly prefix = 'deepseek'
  protected readonly displayName = 'DeepSeek'
  protected readonly defaultModel = 'deepseek-v4-pro'
  // Sort deepseek-v4-pro to the absolute top
  protected readonly preferredModelIds = ['deepseek:deepseek-v4-pro', 'deepseek:deepseek-reasoner']

  constructor(aiKeyService: IAIKeyService, toolRegistry: IToolRegistry) {
    super(aiKeyService, toolRegistry, 'deepseek')
  }

  protected createClient(apiKey: string): OpenAI {
    const baseURL = process.env.DEEPSEEK_BASE_URL || 'https://api.deepseek.com'
    return new OpenAI({ apiKey, baseURL })
  }

  protected includeModel(id: string): boolean {
    return !id.includes('embed') && !id.includes('moderation')
  }

  // Tools are supported for deepseek-v4-pro/deepseek-chat, not the reasoner.
  protected supportsTools(rawModel: string): boolean {
    return !rawModel.includes('reasoner')
  }

  // deepseek recommends leaving temp out for reasoner
  protected temperatureFor(rawModel: string): number | undefined {
    return rawModel.includes('reasoner') ? undefined : 0.0
  }

  // If there is reasoning content returned natively, prepend it
  protected decorateResponse(message: unknown, content: string): string {
    const reasoningContent = (message as { reasoning_content?: string } | undefined)?.reasoning_content
    return reasoningContent ? `<think>\n${reasoningContent}\n</think>\n\n` + content : content
  }

  // Stream reasoning_content natively as a <think> block.
  protected createStreamReasoner(): StreamReasoner {
    let started = false
    let ended = false
    return {
      onDelta(delta, onChunk) {
        if (delta.reasoning_content) {
          if (!started) {
            onChunk('<think>\n')
            started = true
          }
          onChunk(delta.reasoning_content)
        } else if (started && !ended) {
          onChunk('\n</think>\n\n')
          ended = true
        }
      },
      // In case thinking ended right when stream finished
      finish(onChunk) {
        if (started && !ended) {
          onChunk('\n</think>\n\n')
        }
      }
    }
  }

  protected fallbackModels(): ModelInfo[] {
    return [
      { id: 'deepseek:deepseek-v4-pro', name: 'deepseek-v4-pro', provider: 'deepseek', isLocal: false, description: 'DeepSeek Flagship Professional reasoning & chat model' },
      { id: 'deepseek:deepseek-v4-flash', name: 'deepseek-v4-flash', provider: 'deepseek', isLocal: false, description: 'DeepSeek Low-latency fast chat model' },
      { id: 'deepseek:deepseek-chat', name: 'deepseek-chat', provider: 'deepseek', isLocal: false, description: 'DeepSeek Chat Model (legacy/alias)' },
      { id: 'deepseek:deepseek-reasoner', name: 'deepseek-reasoner', provider: 'deepseek', isLocal: false, description: 'DeepSeek Reasoning Model (legacy/alias)' }
    ]
  }
}
