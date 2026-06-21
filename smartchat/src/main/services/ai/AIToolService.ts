import { IToolRegistry, AITool } from './IToolRegistry'
import { ISystemPromptBuilder, UserDetails } from './ISystemPromptBuilder'
import { SystemPromptBuilder } from './SystemPromptBuilder'

export class ToolRegistry implements IToolRegistry {
  private tools: Map<string, AITool> = new Map();

  constructor(private readonly promptBuilder: ISystemPromptBuilder) {}

  registerTool(tool: AITool): void {
    this.tools.set(tool.name, tool);
  }

  getTool(name: string): AITool | undefined {
    return this.tools.get(name);
  }

  getAllTools(): AITool[] {
    return Array.from(this.tools.values());
  }

  getToolDefinitions(): Record<string, unknown>[] {
    return this.getAllTools().map(t => ({
      name: t.name,
      description: t.description,
      parameters: t.parametersSchema
    }));
  }

  getSystemInstructions(useThinkMode: boolean = true, userDetails?: UserDetails): string {
    const tools = this.getToolDefinitions();
    if (tools.length === 0) return '';
    return this.promptBuilder.build(tools, useThinkMode, userDetails);
  }
}

export const toolRegistry = new ToolRegistry(new SystemPromptBuilder());
