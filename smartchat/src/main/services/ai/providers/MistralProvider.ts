import OpenAI from 'openai'
import { ModelInfo } from './IBaseAIProvider'
import { IToolRegistry } from '../IToolRegistry'
import { IAIKeyService } from '../IAIKeyService'
import { BaseOpenAICompatibleProvider } from './BaseOpenAICompatibleProvider'

export class MistralProvider extends BaseOpenAICompatibleProvider {
  protected readonly prefix = 'mistral'
  protected readonly displayName = 'Mistral'
  protected readonly defaultModel = 'mistral-large-latest'
  protected readonly preferredModelIds = ['mistral:mistral-large-latest']

  constructor(aiKeyService: IAIKeyService, toolRegistry: IToolRegistry) {
    super(aiKeyService, toolRegistry, 'mistral')
  }

  protected createClient(apiKey: string): OpenAI {
    const baseURL = process.env.MISTRAL_BASE_URL || 'https://api.mistral.ai/v1'
    return new OpenAI({ apiKey, baseURL })
  }

  protected includeModel(id: string): boolean {
    return !id.includes('embed') && !id.includes('moderation') && !id.includes('guard')
  }

  protected fallbackModels(): ModelInfo[] {
    return [
      { id: 'mistral:mistral-large-latest', name: 'mistral-large-latest', provider: 'mistral', isLocal: false, description: 'Mistral Large Flagship Model' },
      { id: 'mistral:codestral-2508', name: 'codestral-2508', provider: 'mistral', isLocal: false, description: 'Mistral Code Generation Model' },
      { id: 'mistral:pixtral-12b-2409', name: 'pixtral-12b-2409', provider: 'mistral', isLocal: false, description: 'Mistral Multimodal Model' }
    ]
  }
}
