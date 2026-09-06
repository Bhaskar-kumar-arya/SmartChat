import { BaseKernelModule } from './BaseKernelModule'
import { IPermissionStore } from '../permissions/IPermissionStore'
import { IAIService, AIChatContext, AIHistoryMessage, AIMention } from '../../services/ai/IAIService'
import { IAIChatSessionService } from '../../services/ai/IAIChatSessionService'
import { IToolRegistry, AITool } from '../../services/ai/IToolRegistry'
import { IPluginChannel, isBidirectionalPluginChannel } from '../channels/IPluginChannel'
import { KernelError, KernelNotFoundError } from './KernelErrors'

export class KernelAIModule extends BaseKernelModule {
  readonly namespace = 'kernel:ai'

  constructor(
    permissions: IPermissionStore,
    private readonly aiService: IAIService,
    private readonly toolRegistry: IToolRegistry,
    private readonly getChannel?: (pluginId: string) => IPluginChannel | undefined,
    private readonly aiChatSessionService?: IAIChatSessionService
  ) {
    super(permissions)
  }

  /** Tool names each plugin has registered, so they can be torn down on unload. (S7-04) */
  private readonly pluginTools = new Map<string, Set<string>>()

  /**
   * Called by PluginHost when a plugin is unloaded/uninstalled: drop every AI
   * tool it registered so the model can no longer invoke a dead closure and the
   * name is freed for re-registration. (S7-04)
   */
  public removePlugin(pluginId: string): void {
    const names = this.pluginTools.get(pluginId)
    if (!names) return
    for (const name of names) {
      this.toolRegistry.unregisterTool?.(name)
    }
    this.pluginTools.delete(pluginId)
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

      case 'getAvailableModels': {
        this.requireCapability(pluginId, 'ai:chat')
        const models = await this.aiService.getAvailableModels()
        return this.serialize(models)
      }

      case 'createSession': {
        const { title, modelId } = payload as { title: string; modelId?: string | null }
        // Session CRUD exposes the user's *entire* main-app AI chat history
        // (read + delete). That is a much higher bar than "may talk to the
        // LLM", so it needs its own capability rather than riding on `ai:chat`. (S7-03)
        this.requireCapability(pluginId, 'ai:sessions')
        if (!this.aiChatSessionService) {
          throw new KernelError('INTERNAL_ERROR', 'AIChatSessionService is not available in KernelAIModule')
        }
        const session = await this.aiChatSessionService.createSession(title, modelId)
        return this.serialize(session)
      }

      case 'listSessions': {
        const { page = 1, pageSize = 20 } = (payload as { page?: number; pageSize?: number }) || {}
        this.requireCapability(pluginId, 'ai:sessions')
        if (!this.aiChatSessionService) {
          throw new KernelError('INTERNAL_ERROR', 'AIChatSessionService is not available in KernelAIModule')
        }
        const sessions = await this.aiChatSessionService.listSessions(page, pageSize)
        return this.serialize(sessions)
      }

      case 'getSession': {
        const { id } = payload as { id: string }
        this.requireCapability(pluginId, 'ai:sessions')
        if (!this.aiChatSessionService) {
          throw new KernelError('INTERNAL_ERROR', 'AIChatSessionService is not available in KernelAIModule')
        }
        const session = await this.aiChatSessionService.getSession(id)
        return this.serialize(session)
      }

      case 'renameSession': {
        const { id, title } = payload as { id: string; title: string }
        this.requireCapability(pluginId, 'ai:sessions')
        if (!this.aiChatSessionService) {
          throw new KernelError('INTERNAL_ERROR', 'AIChatSessionService is not available in KernelAIModule')
        }
        const updated = await this.aiChatSessionService.renameSession(id, title)
        return this.serialize(updated)
      }

      case 'deleteSession': {
        const { id } = payload as { id: string }
        this.requireCapability(pluginId, 'ai:sessions')
        if (!this.aiChatSessionService) {
          throw new KernelError('INTERNAL_ERROR', 'AIChatSessionService is not available in KernelAIModule')
        }
        await this.aiChatSessionService.deleteSession(id)
        return { success: true }
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

        if (typeof name !== 'string' || name.length === 0) {
          throw new KernelError('BAD_REQUEST', 'registerTool requires a non-empty tool name')
        }
        // Reject a name that already exists — otherwise a plugin can shadow a
        // trusted builtin (`read_messages`, `execute_script`, …) or another
        // plugin's tool, and the user's assistant silently runs the impostor. (S7-04)
        if (this.toolRegistry.getTool(name)) {
          throw new KernelError(
            'TOOL_NAME_CONFLICT',
            `AI tool '${name}' is already registered; choose a unique name`
          )
        }

        const tool: AITool = {
          name,
          description,
          parametersSchema: schema,
          requiresPermission: false,
          execute: async (args: Record<string, unknown>) => {
            const channel = this.getChannel?.(pluginId)
            if (!channel) {
              return { text: `Error: Plugin '${pluginId}' channel is not available` }
            }
            if (!isBidirectionalPluginChannel(channel)) {
              return { text: `Error: Plugin '${pluginId}' channel does not support bidirectional requests` }
            }
            const reqId = `ai-tool-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`
            const res = await channel.sendRequestToPlugin({
              id: reqId,
              type: 'contribution:execute:ai-tool',
              payload: { name, args }
            })
            if (res.ok) {
              let outText: string
              if (typeof res.payload === 'string') {
                outText = res.payload
              } else if (
                res.payload &&
                typeof res.payload === 'object' &&
                'text' in res.payload &&
                typeof (res.payload as { text: unknown }).text === 'string'
              ) {
                outText = (res.payload as { text: string }).text
              } else {
                outText = JSON.stringify(res.payload)
              }
              return { text: outText }
            } else {
              return { text: `Error: ${res.error?.message || 'Tool execution failed'}` }
            }
          }
        }
        this.toolRegistry.registerTool(tool)
        if (!this.pluginTools.has(pluginId)) {
          this.pluginTools.set(pluginId, new Set())
        }
        this.pluginTools.get(pluginId)!.add(name)
        return { success: true, toolName: name }
      }

      default:
        throw new KernelNotFoundError(`Unknown action '${type}' in module '${this.namespace}'`)
    }
  }
}
