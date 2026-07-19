import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { ExtensionLoader } from '../../extensions/host/ExtensionLoader'
import { ExtensionCapabilityRegistry } from '../../extensions/capabilities/ExtensionCapabilityRegistry'
import { LogCapabilityProvider } from '../../extensions/capabilities/providers/LogCapabilityProvider'
import { StorageCapabilityProvider } from '../../extensions/capabilities/providers/StorageCapabilityProvider'
import { ExtensionStorageRepository } from '../../extensions/storage/ExtensionStorageRepository'
import { ExtensionHost } from '../../extensions/host/ExtensionHost'
import AdmZip from 'adm-zip'
import * as fs from 'fs'
import * as path from 'path'
import * as os from 'os'
import { getPrismaClient } from '../helpers'
import { PrismaClient } from '@prisma/client'

describe('ExtensionHost Integration', () => {
  let loader: ExtensionLoader
  let host: ExtensionHost
  let registry: ExtensionCapabilityRegistry
  let tmpDir: string
  let prisma: PrismaClient

  beforeEach(() => {
    tmpDir = path.join(os.tmpdir(), `extension-phase02-test-${Date.now()}`)
    fs.mkdirSync(tmpDir, { recursive: true })
    
    loader = new ExtensionLoader(tmpDir)
    registry = new ExtensionCapabilityRegistry()
    registry.register('log', new LogCapabilityProvider(tmpDir))
    
    prisma = getPrismaClient()
    registry.register('storage', new StorageCapabilityProvider(new ExtensionStorageRepository(prisma)))

    host = new ExtensionHost(loader, registry)
  })

  afterEach(async () => {
    await prisma.extensionKV.deleteMany({ where: { extensionId: 'test.ext.phase02' } })
    await prisma.$disconnect()

    if (fs.existsSync(tmpDir)) {
      fs.rmSync(tmpDir, { recursive: true, force: true })
    }
  })

  function createDummyExtension(manifest: any, indexCode?: string): string {
    const zip = new AdmZip()
    zip.addFile('manifest.json', Buffer.from(JSON.stringify(manifest)))
    if (indexCode) {
      zip.addFile('index.js', Buffer.from(indexCode))
    }
    const scextPath = path.join(tmpDir, `temp-${Date.now()}-${Math.random()}.scext`)
    zip.writeZip(scextPath)
    return scextPath
  }

  const validManifest = {
    id: 'test.ext.phase02',
    version: '1.0.0',
    apiVersion: '1',
    name: 'Test Ext Phase 02',
    description: 'A test extension',
    main: 'index.js',
    permissions: ['storage:read', 'storage:write']
  }

  it('should successfully build the context and execute the extension module', async () => {
    const code = `
      module.exports = async function(ctx) {
        ctx.log.info('Extension activated')
        ctx.onActivate(async () => {
          const currentCount = await ctx.storage.get('boot_count') ?? 0
          await ctx.storage.set('boot_count', currentCount + 1)
          ctx.log.info('Boot count:', await ctx.storage.get('boot_count'))
        })
      }
    `
    const scextPath = createDummyExtension(validManifest, code)
    await loader.install(scextPath)

    // Load first time
    await host.loadAll()
    const logFilePath = path.join(tmpDir, 'test.ext.phase02', 'ext.log')
    expect(fs.existsSync(logFilePath)).toBe(true)
    
    let logContent = fs.readFileSync(logFilePath, 'utf8')
    expect(logContent).toContain('Extension activated')
    expect(logContent).toContain('Boot count: 1')

    // Reload (simulating restart)
    await host.reload('test.ext.phase02')
    
    logContent = fs.readFileSync(logFilePath, 'utf8')
    expect(logContent).toContain('Boot count: 2')

    // Ensure database really persisted
    const savedValue = await prisma.extensionKV.findUnique({
      where: {
        extensionId_key: { extensionId: 'test.ext.phase02', key: 'boot_count' }
      }
    })
    expect(savedValue?.value).toBe('2')
  })
})
