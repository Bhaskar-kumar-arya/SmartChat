import http from 'http'
import { IToolRegistry } from '../../ai/IToolRegistry'
import { readRequestBody, sendJSON } from './helpers'

interface ExecuteToolBody {
  tool: string
  arguments?: Record<string, unknown>
}

function isExecuteToolBody(obj: unknown): obj is ExecuteToolBody {
  return (
    typeof obj === 'object' &&
    obj !== null &&
    'tool' in obj &&
    typeof (obj as ExecuteToolBody).tool === 'string'
  )
}

export class ToolsController {
  constructor(private readonly toolRegistry: IToolRegistry) {}

  getTools = (_req: http.IncomingMessage, res: http.ServerResponse): void => {
    const tools = this.toolRegistry.getAllTools().map(t => ({
      name: t.name,
      description: t.description,
      requiresPermission: t.requiresPermission,
      parametersSchema: t.parametersSchema
    }))
    sendJSON(res, 200, tools)
  }

  executeTool = async (req: http.IncomingMessage, res: http.ServerResponse): Promise<void> => {
    try {
      const body = await readRequestBody(req)
      const data: unknown = JSON.parse(body)
      if (!isExecuteToolBody(data)) {
        sendJSON(res, 400, { error: 'Bad Request: Missing required field "tool" (string)' })
        return
      }

      const tool = this.toolRegistry.getTool(data.tool)
      if (!tool) {
        sendJSON(res, 404, { error: `Tool ${data.tool} not found` })
        return
      }

      // The tool permission model (user prompt for anything with
      // requiresPermission !== false) is enforced only in the renderer. This
      // HTTP surface has no user in the loop, so permission-gated tools
      // (ExecuteScript = RCE, QueryDatabase = arbitrary SQL, SendMessage /
      // MessageAction / ChatAction = act as the user) must not be reachable
      // here. Deny them outright rather than silently running unprompted.
      if (tool.requiresPermission !== false) {
        console.warn(
          `[APIServer] DENIED tools/execute for permission-gated tool "${tool.name}" (no user in the loop on the HTTP surface)`
        )
        sendJSON(res, 403, {
          error: `Tool "${tool.name}" requires user permission and cannot be executed over the HTTP API`
        })
        return
      }

      console.log(`[APIServer] tools/execute "${tool.name}"`)
      const result = await tool.execute(data.arguments || {})
      sendJSON(res, 200, { success: true, result })
    } catch (err) {
      sendJSON(res, 400, { error: `Invalid Request Body/Error: ${err instanceof Error ? err.message : String(err)}` })
    }
  }
}
