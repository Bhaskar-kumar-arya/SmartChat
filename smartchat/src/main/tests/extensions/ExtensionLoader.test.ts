import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { ExtensionLoader } from '../../extensions/host/ExtensionLoader'
import { ManifestValidationError, ApiVersionError } from '../../extensions/types/ExtensionErrors'
import AdmZip from 'adm-zip'
import * as fs from 'fs'
import * as path from 'path'
import * as os from 'os'

describe('ExtensionLoader', () => {
  let loader: ExtensionLoader
  let tmpDir: string

  beforeEach(() => {
    tmpDir = path.join(os.tmpdir(), `extension-loader-test-${Date.now()}`)
    fs.mkdirSync(tmpDir, { recursive: true })
    loader = new ExtensionLoader(tmpDir)
  })

  afterEach(() => {
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
    id: 'test.extension',
    version: '1.0.0',
    apiVersion: '1',
    name: 'Test Ext',
    description: 'A test extension',
    main: 'index.js',
    permissions: []
  }

  it('should install a valid extension', async () => {
    const scextPath = createDummyExtension(validManifest, 'module.exports = {}')
    
    const installed = await loader.install(scextPath)
    expect(installed.id).toBe('test.extension')
    
    const extDir = path.join(tmpDir, 'test.extension')
    expect(fs.existsSync(extDir)).toBe(true)
    expect(fs.existsSync(path.join(extDir, 'manifest.json'))).toBe(true)
    expect(fs.existsSync(path.join(extDir, 'index.js'))).toBe(true)
  })

  it('should throw ManifestValidationError if manifest.json is missing', async () => {
    const zip = new AdmZip()
    zip.addFile('index.js', Buffer.from(''))
    const scextPath = path.join(tmpDir, 'invalid.scext')
    zip.writeZip(scextPath)

    await expect(loader.install(scextPath)).rejects.toThrow(ManifestValidationError)
  })

  it('should throw ApiVersionError if apiVersion is unsupported', async () => {
    const invalidManifest = { ...validManifest, apiVersion: '999' }
    const scextPath = createDummyExtension(invalidManifest, 'module.exports = {}')
    
    await expect(loader.install(scextPath)).rejects.toThrow(ApiVersionError)
  })

  it('should load an installed extension module', async () => {
    const code = 'module.exports = async function(ctx) { return "activated" }'
    const scextPath = createDummyExtension(validManifest, code)
    await loader.install(scextPath)

    const mod = await loader.load('test.extension')
    expect(typeof mod).toBe('function')
    if (typeof mod === 'function') {
      const result = await mod({})
      expect(result).toBe('activated')
    }
  })

  it('should list installed extensions', async () => {
    const scextPath1 = createDummyExtension(validManifest, 'module.exports = {}')
    const scextPath2 = createDummyExtension({ ...validManifest, id: 'test.ext2' }, 'module.exports = {}')
    
    await loader.install(scextPath1)
    await loader.install(scextPath2)

    const installed = await loader.listInstalled()
    expect(installed).toHaveLength(2)
    expect(installed.map(m => m.id).sort()).toEqual(['test.ext2', 'test.extension'])
  })

  it('should uninstall an extension', async () => {
    const scextPath = createDummyExtension(validManifest, 'module.exports = {}')
    await loader.install(scextPath)
    
    expect(fs.existsSync(path.join(tmpDir, 'test.extension'))).toBe(true)
    
    await loader.uninstall('test.extension')
    expect(fs.existsSync(path.join(tmpDir, 'test.extension'))).toBe(false)
  })
})
