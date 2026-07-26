import { IKernelModule } from './IKernelModule'
import { IPermissionStore } from '../permissions/IPermissionStore'
import { IAIService, AIChatContext, AIHistoryMessage, AIMention } from '../../services/ai/IAIService'
import { IToolRegistry, AITool } from '../../services/ai/IToolRegistry'

export class KernelAIModule implements IKernelModule {
  readonly namespace = 'kernel:ai'

  constructor(
    private readonly permissions: IPermissionStore,
    private readonly aiService: IAIService,
    private readonly toolRegistry: IToolRegistry
  ) {}

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
        this.requireResourceScope(pluginId, 'ai:tools:call', toolName)

        const tool = this.toolRegistry.getTool(toolName)
        if (!tool) {
          throw {
            code: 'NOT_FOUND',
            message: `AI Tool '${toolName}' not found in ToolRegistry`
          }
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
        throw {
          code: 'NOT_FOUND',
          message: `Unknown action '${type}' in module '${this.namespace}'`
        }
    }
  }

  private extractAction(type: string): string {
    const parts = type.split(':')
    return parts.length > 2 ? parts.slice(2).join(':') : parts[1] || type
  }

  private requireCapability(pluginId: string, capability: string): void {
    if (!this.permissions.hasCapability(pluginId, capability)) {
      throw {
        code: 'PERMISSION_DENIED',
        message: `Plugin '${pluginId}' lacks capability '${capability}'`,
        permission: capability
      }
    }
  }

  private requireResourceScope(pluginId: string, capability: string, resourceId: string): void {
    if (!this.permissions.isResourceAllowed(pluginId, capability, resourceId)) {
      throw {
        code: 'PERMISSION_DENIED',
        message: `Plugin '${pluginId}' is denied access to tool '${resourceId}' for capability '${capability}'`,
        permission: capability
      }
    }
  }
}
