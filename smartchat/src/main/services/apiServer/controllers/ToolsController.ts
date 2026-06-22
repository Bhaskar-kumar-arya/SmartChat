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

      const result = await tool.execute(data.arguments || {})
      sendJSON(res, 200, { success: true, result })
    } catch (err) {
      sendJSON(res, 400, { error: `Invalid Request Body/Error: ${err instanceof Error ? err.message : String(err)}` })
    }
  }
}
