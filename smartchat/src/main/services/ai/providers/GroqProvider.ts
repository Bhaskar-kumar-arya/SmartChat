import Groq from 'groq-sdk'
import type OpenAI from 'openai'
import { ModelInfo } from './IBaseAIProvider'
import { IToolRegistry } from '../IToolRegistry'
import { IAIKeyService } from '../IAIKeyService'
import { BaseOpenAICompatibleProvider } from './BaseOpenAICompatibleProvider'

export class GroqProvider extends BaseOpenAICompatibleProvider {
  protected readonly prefix = 'groq'
  protected readonly displayName = 'Groq'
  protected readonly defaultModel = 'openai/gpt-oss-120b'
  protected readonly preferredModelIds = ['groq:openai/gpt-oss-120b']

  constructor(aiKeyService: IAIKeyService, toolRegistry: IToolRegistry) {
    super(aiKeyService, toolRegistry, 'groq')
  }

  protected createClient(apiKey: string): OpenAI {
    // groq-sdk mirrors the OpenAI chat-completions / models surface used by the base class.
    return new Groq({ apiKey }) as unknown as OpenAI
  }

  protected includeModel(id: string): boolean {
    return !id.includes('whisper') && !id.includes('embed') && !id.includes('audio')
  }

  protected fallbackModels(): ModelInfo[] {
    // Solid fallback models in case of network/key issues on startup
    return [
      { id: 'groq:openai/gpt-oss-120b', name: 'openai/gpt-oss-120b', provider: 'groq', isLocal: false },
      { id: 'groq:llama-3.3-70b-versatile', name: 'llama-3.3-70b-versatile', provider: 'groq', isLocal: false },
      { id: 'groq:llama-3.1-8b-instant', name: 'llama-3.1-8b-instant', provider: 'groq', isLocal: false },
      { id: 'groq:mixtral-8x7b-32768', name: 'mixtral-8x7b-32768', provider: 'groq', isLocal: false }
    ]
  }
}
