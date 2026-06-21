import { IToolRegistry, AITool } from './IToolRegistry'
import { ISystemPromptBuilder, UserDetails } from './ISystemPromptBuilder'

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
    const protocolMode = useThinkMode ? 'react' : 'standard';
    return this.promptBuilder.build(tools, protocolMode, userDetails);
  }
}

