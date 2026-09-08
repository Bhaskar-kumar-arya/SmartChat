import { describe, it, expect, vi } from 'vitest'
import { EventEmitter } from 'events'
import { ToolsController } from '../../../services/apiServer/controllers/ToolsController'
import type { AITool, IToolRegistry, ToolResult } from '../../../services/ai/IToolRegistry'

function makeReq(body: string): any {
  const req = new EventEmitter() as any
  process.nextTick(() => {
    req.emit('data', Buffer.from(body))
    req.emit('end')
  })
  return req
}

function makeRes(): { res: any; status: () => number; body: () => unknown } {
  let statusCode = 0
  let payload = ''
  const res: any = {
    writeHead: (code: number) => {
      statusCode = code
    },
    end: (chunk?: string) => {
      if (chunk) payload = chunk
    }
  }
  return { res, status: () => statusCode, body: () => (payload ? JSON.parse(payload) : undefined) }
}

function registry(tools: AITool[]): IToolRegistry {
  return {
    registerTool: vi.fn(),
    unregisterTool: vi.fn(),
    getTool: (n: string) => tools.find(t => t.name === n),
    getAllTools: () => tools,
    getToolDefinitions: () => []
  }
}

const safeTool: AITool = {
  name: 'readOnly',
  description: '',
  parametersSchema: {},
  requiresPermission: false,
  execute: async (): Promise<ToolResult> => ({ text: '{"ok":true}' })
}

const dangerousTool: AITool = {
  name: 'executeScript',
  description: '',
  parametersSchema: {},
  requiresPermission: true,
  execute: vi.fn(async (): Promise<ToolResult> => ({ text: '{"pwned":true}' }))
}

describe('ToolsController.executeTool permission gate (S11-01)', () => {
  it('denies permission-gated tools with 403 and never executes them', async () => {
    const ctrl = new ToolsController(registry([dangerousTool]))
    const { res, status, body } = makeRes()
    await ctrl.executeTool(makeReq(JSON.stringify({ tool: 'executeScript', arguments: {} })), res)
    expect(status()).toBe(403)
    expect((body() as { error: string }).error).toMatch(/requires user permission/)
    expect(dangerousTool.execute).not.toHaveBeenCalled()
  })

  it('still allows tools that do not require permission', async () => {
    const ctrl = new ToolsController(registry([safeTool]))
    const { res, status, body } = makeRes()
    await ctrl.executeTool(makeReq(JSON.stringify({ tool: 'readOnly' })), res)
    expect(status()).toBe(200)
    expect(body()).toEqual({ success: true, result: { text: '{"ok":true}' } })
  })

  it('treats a tool with an undefined requiresPermission as gated (fail closed)', async () => {
    const weird = { ...safeTool, name: 'weird', requiresPermission: undefined as unknown as boolean }
    const ctrl = new ToolsController(registry([weird]))
    const { res, status } = makeRes()
    await ctrl.executeTool(makeReq(JSON.stringify({ tool: 'weird' })), res)
    expect(status()).toBe(403)
  })
})
