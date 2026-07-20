import { ICapabilityProvider } from '../ICapabilityProvider'
import { ExtensionManifest } from '../../types/ExtensionManifest'
import { IExtensionLlmAPI, LlmChatOptions } from '../../context/ExtensionContext'
import { IAIService, AIHistoryMessage } from '../../../services/ai/IAIService'
import { IAIChatSessionService } from '../../../services/ai/IAIChatSessionService'
import { IDocSource, DocSection } from '../../docs/IDocSource'
import { GENERATED_INTERFACES } from '../../docs/generatedDocs'

export class LlmCapabilityProvider implements ICapabilityProvider<IExtensionLlmAPI>, IDocSource {
  public getDocSection(): DocSection {
    let body = `Call LLM generation with the same prompt context as used by the main chatbar AI.\n\n`
    if (GENERATED_INTERFACES['IExtensionLlmAPI']) {
      body += `API:\n${GENERATED_INTERFACES['IExtensionLlmAPI']}\n\n`
    }
    if (GENERATED_INTERFACES['LlmChatOptions']) {
      body += `Options Shape:\n${GENERATED_INTERFACES['LlmChatOptions']}\n\n`
    }
    if (GENERATED_INTERFACES['LlmHistoryMessage']) {
      body += `History Message Shape:\n${GENERATED_INTERFACES['LlmHistoryMessage']}\n\n`
    }
    return {
      heading: 'ctx.llm',
      permissions: ['llm:chat'],
      body: body.trim()
    }
  }

  readonly permissions = ['llm:chat']

  constructor(
    private readonly aiService: IAIService,
    private readonly aiChatSessionService: IAIChatSessionService
  ) {}

  build(manifest: ExtensionManifest, _extensionId: string): IExtensionLlmAPI | undefined {
    if (!manifest.permissions.includes('llm:chat')) {
      return undefined
    }

    return {
      chat: async (prompt: string, options?: LlmChatOptions): Promise<string> => {
        const aiOptions = await this.aiChatSessionService.getAIOptions()
        const model = options?.model || aiOptions.model
        const useThinkMode = options?.useThinkMode !== undefined ? options.useThinkMode : aiOptions.useThinkMode

        const history: AIHistoryMessage[] = (options?.history || []).map((h) => ({
          role: h.role === 'ai' ? 'ai' : 'user',
          content: h.content,
          isSystem: h.role === 'system'
        }))

        return await this.aiService.generateResponseWithTools(
          prompt,
          undefined, // contextFiles
          history,
          undefined, // mentions
          {
            model,
            useThinkMode
          }
        )
      }
    }
  }
}
