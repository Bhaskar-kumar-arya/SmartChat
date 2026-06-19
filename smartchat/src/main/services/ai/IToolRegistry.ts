import { AITool } from './AIToolService'
import { UserDetails } from './SystemPromptBuilder'

export interface IToolRegistry {
  registerTool(tool: AITool): void
  getTool(name: string): AITool | undefined
  getAllTools(): AITool[]
  getToolDefinitions(): any[]
  getSystemInstructions(useThinkMode?: boolean, userDetails?: UserDetails): string
}
