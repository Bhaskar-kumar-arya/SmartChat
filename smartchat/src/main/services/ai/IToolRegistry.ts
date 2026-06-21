export interface AITool {
  name: string;
  description: string;
  parametersSchema: object;
  requiresPermission: boolean;
  execute: (args: Record<string, unknown>) => Promise<unknown>;
  /** Optional async setup (e.g. DB introspection). Called once after registration. */
  initialize?: () => Promise<void>;
}

export interface IToolRegistry {
  registerTool(tool: AITool): void
  getTool(name: string): AITool | undefined
  getAllTools(): AITool[]
  getToolDefinitions(): Record<string, unknown>[]
}
