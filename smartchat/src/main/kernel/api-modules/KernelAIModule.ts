import { BaseKernelModule } from './BaseKernelModule'
import { IPermissionStore } from '../permissions/IPermissionStore'
import { IAIService, AIChatContext, AIHistoryMessage, AIMention } from '../../services/ai/IAIService'
import { IToolRegistry, AITool } from '../../services/ai/IToolRegistry'
import { KernelNotFoundError } from './KernelErrors'

export class KernelAIModule extends BaseKernelModule {
  readonly namespace = 'kernel:ai'

  constructor(
    permissions: IPermissionStore,
    private readonly aiService: IAIService,
    private readonly toolRegistry: IToolRegistry
  ) {
    super(permissions)
  }

  async handle(pluginId: string, type: string, payload: unknown): Promise<unknown> {
    const action = this.extractAction(type)

    switch (action) {
      case 'chat': {
        const { prompt, contextFiles, history, mentions, options } = payload as {
          prompt: string
          contextFiles?: AIChatContext[]
          history?: AIHistoryMessage[]
          mentions?: AIMention[]
          options?: { useThinkMode?: boolean; model?: string; isSystem?: boolean; requestId?: string }
        }
        this.requireCapability(pluginId, 'ai:chat')
        return await this.aiService.generateResponse(prompt, contextFiles, history, mentions, options)
      }

      case 'callTool': {
        const { toolName, args } = payload as { toolName: string; args: Record<string, unknown> }
        this.requireCapability(pluginId, 'ai:tools:call')
        this.requireResourceScope(pluginId, 'ai:tools:call', toolName, 'tool')

        const tool = this.toolRegistry.getTool(toolName)
        if (!tool) {
          throw new KernelNotFoundError(`AI Tool '${toolName}' not found in ToolRegistry`)
        }
        return await tool.execute(args || {})
      }

      case 'registerTool': {
        const { name, description, schema } = payload as {
          name: string
          description: string
          schema: object
        }
        this.requireCapability(pluginId, 'ai:tools:register')

        const tool: AITool = {
          name,
          description,
          parametersSchema: schema,
          requiresPermission: false,
          execute: async (args: Record<string, unknown>) => {
            return { text: `Tool ${name} executed with args ${JSON.stringify(args)}` }
          }
        }
        this.toolRegistry.registerTool(tool)
        return { success: true, toolName: name }
      }

      default:
        throw new KernelNotFoundError(`Unknown action '${type}' in module '${this.namespace}'`)
    }
  }
}
