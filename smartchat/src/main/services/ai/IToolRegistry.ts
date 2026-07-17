import { ICitationEmitter, CitationEntity } from './citations';

export interface ToolExecutionContext {
  citationEmitter?: ICitationEmitter;
  sessionId?: string;
}

export interface ToolResult {
  text: string;
  citations?: ReadonlyMap<number, CitationEntity>;
}

export interface AITool {
  name: string;
  description: string;
  parametersSchema: object;
  requiresPermission: boolean;
  execute: (args: Record<string, unknown>, ctx?: ToolExecutionContext) => Promise<ToolResult>;
  /** Optional async setup (e.g. DB introspection). Called once after registration. */
  initialize?: () => Promise<void>;
  /** Capability flag — checked by the orchestrator to decide whether to inject a CitationEmitter */
  readonly supportsCitations?: boolean;
}

export interface IToolRegistry {
  registerTool(tool: AITool): void
  getTool(name: string): AITool | undefined
  getAllTools(): AITool[]
  getToolDefinitions(): Record<string, unknown>[]
}
