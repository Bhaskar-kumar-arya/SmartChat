export interface AITool {
  name: string;
  description: string;
  parametersSchema: object;
  requiresPermission: boolean;
  execute: (args: any) => Promise<any>;
  /** Optional async setup (e.g. DB introspection). Called once after registration. */
  initialize?: () => Promise<void>;
}

import { IToolRegistry } from './IToolRegistry'
import { SystemPromptBuilder, UserDetails } from './SystemPromptBuilder'

export class ToolRegistry implements IToolRegistry {
  private tools: Map<string, AITool> = new Map();

  registerTool(tool: AITool) {
    this.tools.set(tool.name, tool);
  }

  getTool(name: string): AITool | undefined {
    return this.tools.get(name);
  }

  getAllTools(): AITool[] {
    return Array.from(this.tools.values());
  }

  getToolDefinitions(): any[] {
    return this.getAllTools().map(t => ({
      name: t.name,
      description: t.description,
      parameters: t.parametersSchema
    }));
  }

  getSystemInstructions(useThinkMode: boolean = true, userDetails?: UserDetails): string {
    const tools = this.getToolDefinitions();
    if (tools.length === 0) return '';
    return SystemPromptBuilder.build(tools, useThinkMode, userDetails);
  }
}

export const toolRegistry = new ToolRegistry();
