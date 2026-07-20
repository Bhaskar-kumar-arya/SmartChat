import { ICapabilityProvider } from '../ICapabilityProvider'
import { ExtensionManifest } from '../../types/ExtensionManifest'
import { IExtensionToolAPI, ToolResult, ExtensionTool } from '../../context/ExtensionContext'
import { IToolRegistry, AITool } from '../../../services/ai/IToolRegistry'
import { IExtensionLogAPI } from '../../context/ExtensionContext'
import { IDocSource, DocSection } from '../../docs/IDocSource'

import { GENERATED_INTERFACES } from '../../docs/generatedDocs'

export class ToolCapabilityProvider implements ICapabilityProvider<IExtensionToolAPI>, IDocSource {
  public getDocSection(): DocSection {
    let body = `Call built-in AI tools or register custom tools.\n\n`
    if (GENERATED_INTERFACES['IExtensionToolCallAPI']) {
      body += `Call API:\n${GENERATED_INTERFACES['IExtensionToolCallAPI']}\n\n`
    }
    if (GENERATED_INTERFACES['IExtensionToolRegisterAPI']) {
      body += `Register API:\n${GENERATED_INTERFACES['IExtensionToolRegisterAPI']}\n\n`
    }
    if (GENERATED_INTERFACES['ExtensionTool']) {
      body += `Shape Definitions:\n${GENERATED_INTERFACES['ExtensionTool']}\n`
    }
    return {
      heading: 'ctx.tools',
      permissions: ['tools:read', 'tools:register'],
      body: body.trim()
    }
  }

  readonly permissions: string[] = ['tools:read', 'tools:register']

  constructor(
    private readonly toolRegistry: IToolRegistry,
    private readonly logFactory?: (extensionId: string) => IExtensionLogAPI
  ) {}

  build(manifest: ExtensionManifest, extensionId: string): IExtensionToolAPI | undefined {
    const hasRead = manifest.permissions.includes('tools:read')
    const hasRegister = manifest.permissions.includes('tools:register')

    if (!hasRead && !hasRegister) {
      return undefined
    }

    const api: IExtensionToolAPI = {}
    
    // We bind a logger if a factory was provided, else fallback to console.error
    const logger = this.logFactory ? this.logFactory(extensionId) : {
      error: (msg: string, ...data: any[]) => console.error(`[Extension ${extensionId}] ${msg}`, ...data)
    }

    if (hasRead) {
      api.call = async (toolName: string, args: Record<string, unknown>): Promise<ToolResult> => {
        const tool = this.toolRegistry.getTool(toolName)
        if (!tool) {
          throw new Error(`Tool ${toolName} not found`)
        }
        return await tool.execute(args)
      }
      api.list = (): string[] => {
        return this.toolRegistry.getAllTools().map(t => t.name)
      }
    }

    if (hasRegister) {
      api.register = (tool: ExtensionTool): void => {
        const existing = this.toolRegistry.getTool(tool.name)
        if (existing) {
          throw new Error(`Tool ${tool.name} is already registered`)
        }

        const aiTool: AITool = {
          name: tool.name,
          description: tool.description,
          parametersSchema: tool.schema,
          requiresPermission: false, // Internal extension tool
          execute: async (args: Record<string, unknown>): Promise<import('../../../services/ai/IToolRegistry').ToolResult> => {
            try {
              const res = await tool.execute(args)
              return { text: res.text }
            } catch (err) {
              logger.error(`Error executing tool ${tool.name}`, err)
              throw err
            }
          }
        }
        
        this.toolRegistry.registerTool(aiTool)
      }

      if (!api.list) {
        api.list = (): string[] => {
          return this.toolRegistry.getAllTools().map(t => t.name)
        }
      }
    }

    return api
  }
}
