import { IBuiltinPlugin } from '../../../kernel/plugins/IBuiltinPlugin'
import { PluginManifest } from '../../../kernel/plugins/PluginManifest'
import { PluginContext } from '../../../kernel/plugins/PluginContext'
import { IToolRegistry, AITool } from '../../../services/ai/IToolRegistry'

export class AIAssistantPlugin implements IBuiltinPlugin {
  readonly id = 'com.smartchat.builtin.ai-assistant'

  readonly manifest: PluginManifest = {
    id: 'com.smartchat.builtin.ai-assistant',
    name: 'AI Assistant Plugin',
    version: '1.0.0',
    apiVersion: '2',
    main: 'index.ts',
    permissions: ['ai:tools:register', 'ai:tools:call'],
    contributions: {
      aiTools: [
        {
          name: 'chatAction',
          description: 'Perform an action on a WhatsApp chat (mute, pin, archive, mark read)',
          schema: { type: 'object' }
        },
        {
          name: 'sendMessage',
          description: 'Send a WhatsApp message to a chat or person',
          schema: { type: 'object' }
        },
        {
          name: 'messageAction',
          description: 'Perform an action on a WhatsApp message (delete, edit, forward, react)',
          schema: { type: 'object' }
        },
        {
          name: 'readMessages',
          description: 'Read and format chat transcripts and message histories',
          schema: { type: 'object' }
        },
        {
          name: 'queryDatabase',
          description: 'Query the SQLite database directly',
          schema: { type: 'object' }
        },
        {
          name: 'executeScript',
          description: 'Write and execute a JavaScript program that can call registered tools',
          schema: { type: 'object' }
        }
      ]
    }
  }

  constructor(private readonly toolRegistry?: IToolRegistry | Map<string, AITool>) {}

  async activate(ctx: PluginContext): Promise<void> {
    const tools = [
      'chatAction',
      'sendMessage',
      'messageAction',
      'readMessages',
      'queryDatabase',
      'executeScript'
    ]

    for (const toolName of tools) {
      ctx.contributions.registerAITool?.(toolName, async (rawArgs: Record<string, unknown>) => {
        ctx.log.info(`Executing AI tool: ${toolName}`, rawArgs)
        const args = (rawArgs && typeof rawArgs === 'object' && 'args' in rawArgs ? rawArgs.args : rawArgs) as Record<string, unknown>

        if (this.toolRegistry) {
          const tool = 'getTool' in this.toolRegistry
            ? this.toolRegistry.getTool(toolName)
            : this.toolRegistry.get(toolName)
          if (tool) {
            const res = await tool.execute(args || {})
            return { text: res.text }
          }
        }

        if (ctx.ai?.callTool) {
          return await ctx.ai.callTool(toolName, args || {})
        }

        return { text: JSON.stringify({ success: true, tool: toolName }) }
      })
    }
  }

  async deactivate(): Promise<void> {
    // Cleanup handled by host
  }
}
