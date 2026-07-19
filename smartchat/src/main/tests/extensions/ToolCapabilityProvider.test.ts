import fs from 'fs'
import path from 'path'
import { ExtensionLoader } from '../../extensions/host/ExtensionLoader'
import { ExtensionCapabilityRegistry } from '../../extensions/capabilities/ExtensionCapabilityRegistry'
import { ExtensionHost } from '../../extensions/host/ExtensionHost'
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { ToolCapabilityProvider } from '../../extensions/capabilities/providers/ToolCapabilityProvider'
import { IToolRegistry, AITool } from '../../services/ai/IToolRegistry'
import { LogCapabilityProvider } from '../../extensions/capabilities/providers/LogCapabilityProvider'
import AdmZip from 'adm-zip'

describe('ToolCapabilityProvider', () => {
  let tmpDir: string
  let registry: ExtensionCapabilityRegistry
  let host: ExtensionHost
  let mockToolRegistry: IToolRegistry
  let registeredTools: Map<string, AITool>

  beforeEach(() => {
    tmpDir = path.join(__dirname, 'tmp_ext_05')
    if (fs.existsSync(tmpDir)) {
      fs.rmSync(tmpDir, { recursive: true, force: true })
    }
    fs.mkdirSync(tmpDir, { recursive: true })

    registeredTools = new Map()
    mockToolRegistry = {
      registerTool: vi.fn((tool: AITool) => registeredTools.set(tool.name, tool)),
      getTool: vi.fn((name: string) => registeredTools.get(name)),
      getAllTools: vi.fn(() => Array.from(registeredTools.values())),
      getToolDefinitions: vi.fn(() => []),
    }

    const loader = new ExtensionLoader(tmpDir)
    registry = new ExtensionCapabilityRegistry()

    const logProvider = new LogCapabilityProvider(tmpDir)
    registry.register('log', logProvider)
    registry.register('tools', new ToolCapabilityProvider(
      mockToolRegistry,
      (extId) => logProvider.build({} as any, extId)
    ))

    host = new ExtensionHost(
      loader,
      registry,
      {
        setInterval: vi.fn(),
        setTimeout: vi.fn(),
        registerCron: vi.fn(),
        cancelAll: vi.fn()
      } as any
    )
  })

  afterEach(() => {
    if (fs.existsSync(tmpDir)) {
      fs.rmSync(tmpDir, { recursive: true, force: true })
    }
  })

  const createExtension = async (id: string, permissions: string[], scriptContent: string) => {
    const manifest = {
      id,
      version: '1.0.0',
      apiVersion: '1',
      name: 'Test Ext',
      description: 'test',
      main: 'index.js',
      permissions
    }
    
    const zip = new AdmZip()
    zip.addFile('manifest.json', Buffer.from(JSON.stringify(manifest)))
    zip.addFile('index.js', Buffer.from(scriptContent))
    const zipPath = path.join(tmpDir, `${id}.scext`)
    zip.writeZip(zipPath)

    return zipPath
  }

  it('Scenario A: call a built-in tool', async () => {
    mockToolRegistry.registerTool({
      name: 'readMessages',
      description: 'Reads msgs',
      parametersSchema: {},
      requiresPermission: false,
      execute: async () => ({ text: 'mock messages' })
    })

    const zipPath = await createExtension('test-ext-read', ['tools:read'], `
      module.exports = async function(ctx) {
        ctx.onActivate(async () => {
          const result = await ctx.tools.call('readMessages', { chatJid: 'test' })
          ctx.log.info(result.text)
        })
      }
    `)

    const loader = (host as any).loader as ExtensionLoader
    await loader.install(zipPath)
    await host.load('test-ext-read')

    const logContent = fs.readFileSync(path.join(tmpDir, 'test-ext-read', 'ext.log'), 'utf8')
    expect(logContent).toContain('mock messages')
  })

  it('Scenario B: register a custom tool', async () => {
    const zipPath = await createExtension('test-ext-reg', ['tools:register'], `
      module.exports = async function(ctx) {
        ctx.onActivate(async () => {
          ctx.tools.register({
            name: 'getTime',
            description: 'Returns the current time',
            schema: { type: 'object', properties: {}, required: [] },
            execute: async () => ({ text: 'fixed time' })
          })
        })
      }
    `)

    const loader = (host as any).loader as ExtensionLoader
    await loader.install(zipPath)
    await host.load('test-ext-reg')

    const timeTool = mockToolRegistry.getTool('getTime')
    expect(timeTool).toBeDefined()
    expect(timeTool?.description).toBe('Returns the current time')
    
    if (timeTool) {
      const res = await timeTool.execute({})
      expect(res.text).toBe('fixed time')
    }
  })
})
