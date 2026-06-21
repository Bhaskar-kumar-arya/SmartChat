export interface ToolDefinition {
  name: string
  description?: string
  argumentsSchema?: Record<string, any>
  requiresPermission?: boolean
}
