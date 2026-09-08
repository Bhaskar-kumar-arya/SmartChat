import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import * as fs from 'fs'
import * as path from 'path'
import * as os from 'os'
import AdmZip from 'adm-zip'
import { PluginLoader } from '../../../kernel/plugins/PluginLoader'
import { ApiVersionError, ManifestValidationError, validateManifest } from '../../../kernel/plugins/PluginManifest'

describe('PluginLoader', () => {
  let tmpDir: string
  let loader: PluginLoader

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sc-plugin-loader-test-'))
    loader = new PluginLoader(tmpDir)
  })

  afterEach(() => {
    if (fs.existsSync(tmpDir)) {
      fs.rmSync(tmpDir, { recursive: true, force: true })
    }
  })

  it('install() with a valid manifest v2 .scext succeeds and extracts to baseDir/<id>', async () => {
    const zip = new AdmZip()
    const validManifest = {
      id: 'com.acme.test-plugin',
      name: 'Test Plugin',
      version: '1.0.0',
      apiVersion: '2',
      main: 'index.js',
      permissions: ['messages:read'],
      contributions: {
        chatActions: [{ id: 'action-1', label: 'Test Action' }]
      }
    }
    zip.addFile('manifest.json', Buffer.from(JSON.stringify(validManifest, null, 2)))
    zip.addFile('index.js', Buffer.from('console.log("hello")'))

    const zipPath = path.join(tmpDir, 'test-plugin.scext')
    zip.writeZip(zipPath)

    const installedManifest = await loader.install(zipPath)

    expect(installedManifest.id).toBe('com.acme.test-plugin')
    const extractedDir = path.join(tmpDir, 'com.acme.test-plugin')
    expect(fs.existsSync(extractedDir)).toBe(true)
    expect(fs.existsSync(path.join(extractedDir, 'manifest.json'))).toBe(true)
    expect(fs.existsSync(path.join(extractedDir, 'index.js'))).toBe(true)
  })

  it('install() with a v1 manifest (missing contributions key or apiVersion !== 2) throws a validation error', async () => {
    const zip = new AdmZip()
    const v1Manifest = {
      id: 'com.acme.v1-plugin',
      name: 'V1 Plugin',
      version: '1.0.0',
      apiVersion: '1',
      main: 'index.js',
      permissions: ['messages:read']
      // missing contributions
    }
    zip.addFile('manifest.json', Buffer.from(JSON.stringify(v1Manifest, null, 2)))

    const zipPath = path.join(tmpDir, 'v1-plugin.scext')
    zip.writeZip(zipPath)

    await expect(loader.install(zipPath)).rejects.toThrow(ApiVersionError)
  })

  it('listInstalled() returns manifests from valid directories and skips invalid ones', async () => {
    const validDir = path.join(tmpDir, 'com.acme.valid')
    fs.mkdirSync(validDir, { recursive: true })
    const validManifest = {
      id: 'com.acme.valid',
      name: 'Valid Plugin',
      version: '1.0.0',
      apiVersion: '2',
      main: 'index.js',
      permissions: [],
      contributions: {}
    }
    fs.writeFileSync(path.join(validDir, 'manifest.json'), JSON.stringify(validManifest))

    const invalidDir = path.join(tmpDir, 'com.acme.invalid')
    fs.mkdirSync(invalidDir, { recursive: true })
    fs.writeFileSync(path.join(invalidDir, 'manifest.json'), 'invalid json{{{')

    const installed = await loader.listInstalled()

    expect(installed).toHaveLength(1)
    expect(installed[0].id).toBe('com.acme.valid')
  })

  it('install() rejects a manifest whose id is a path traversal (S8-01)', async () => {
    const zip = new AdmZip()
    const evil = {
      id: '../../../../evil',
      name: 'Evil',
      version: '1.0.0',
      apiVersion: '2',
      main: 'index.js',
      permissions: [],
      contributions: {}
    }
    zip.addFile('manifest.json', Buffer.from(JSON.stringify(evil)))
    zip.addFile('index.js', Buffer.from('//'))
    const zipPath = path.join(tmpDir, 'evil.scext')
    zip.writeZip(zipPath)

    await expect(loader.install(zipPath)).rejects.toThrow(ManifestValidationError)
    expect(fs.existsSync(path.join(tmpDir, '..', '..', '..', '..', 'evil'))).toBe(false)
  })

  it('uninstall() with a traversal id throws instead of deleting an arbitrary directory (S8-01)', async () => {
    const victim = fs.mkdtempSync(path.join(os.tmpdir(), 'sc-victim-'))
    fs.writeFileSync(path.join(victim, 'important.txt'), 'keep me')
    try {
      const rel = path.relative(tmpDir, victim).split(path.sep).join('/')
      await expect(loader.uninstall(rel)).rejects.toThrow(ManifestValidationError)
      expect(fs.existsSync(path.join(victim, 'important.txt'))).toBe(true)
    } finally {
      fs.rmSync(victim, { recursive: true, force: true })
    }
  })

  it('validateManifest rejects traversal in id and main', () => {
    const base = {
      name: 'X',
      version: '1.0.0',
      apiVersion: '2',
      permissions: [],
      contributions: {}
    }
    expect(() => validateManifest({ ...base, id: 'ok.plugin', main: '../x.js' })).toThrow(ManifestValidationError)
    expect(() => validateManifest({ ...base, id: 'a/b', main: 'index.js' })).toThrow(ManifestValidationError)
    expect(() => validateManifest({ ...base, id: '..', main: 'index.js' })).toThrow(ManifestValidationError)
    // reverse-DNS ids still accepted
    expect(validateManifest({ ...base, id: 'com.smartchat.foo-bar', main: 'index.js' }).id).toBe('com.smartchat.foo-bar')
  })

  const makeScext = (manifest: Record<string, unknown>, files: Record<string, string> = {}): string => {
    const zip = new AdmZip()
    zip.addFile('manifest.json', Buffer.from(JSON.stringify(manifest)))
    for (const [name, body] of Object.entries({ 'index.js': '//', ...files })) {
      zip.addFile(name, Buffer.from(body))
    }
    const zipPath = path.join(tmpDir, `${String(manifest.id).replace(/[^\w.-]/g, '_')}.scext`)
    zip.writeZip(zipPath)
    return zipPath
  }

  it('install() rejects an id reserved by a built-in plugin (S8-01)', async () => {
    const reserved = new PluginLoader(tmpDir, (id) => id === 'com.smartchat.builtin.whatsapp-core')
    const zipPath = makeScext({
      id: 'com.smartchat.builtin.whatsapp-core',
      name: 'Impostor',
      version: '1.0.0',
      apiVersion: '2',
      main: 'index.js',
      permissions: [],
      contributions: {}
    })
    await expect(reserved.install(zipPath)).rejects.toThrow(ManifestValidationError)
    expect(fs.existsSync(path.join(tmpDir, 'com.smartchat.builtin.whatsapp-core'))).toBe(false)
  })

  it('load() and listInstalled() ignore an on-disk dir whose id is reserved (S8-01)', async () => {
    const dir = path.join(tmpDir, 'com.smartchat.builtin.notifications')
    fs.mkdirSync(dir, { recursive: true })
    fs.writeFileSync(
      path.join(dir, 'manifest.json'),
      JSON.stringify({
        id: 'com.smartchat.builtin.notifications',
        name: 'Impostor',
        version: '1.0.0',
        apiVersion: '2',
        main: 'index.js',
        permissions: [],
        contributions: {}
      })
    )
    fs.writeFileSync(path.join(dir, 'index.js'), '//')

    const reserved = new PluginLoader(tmpDir, (id) => id === 'com.smartchat.builtin.notifications')
    expect(await reserved.listInstalled()).toHaveLength(0)
    await expect(reserved.load('com.smartchat.builtin.notifications')).rejects.toThrow(ManifestValidationError)
  })

  it('install() over an existing install clears stale files first (S8-07)', async () => {
    const manifest = {
      id: 'com.acme.upgrade',
      name: 'Upgrade',
      version: '1.0.0',
      apiVersion: '2',
      main: 'index.js',
      permissions: [],
      contributions: {}
    }
    await loader.install(makeScext(manifest, { 'old-file.js': 'stale' }))
    const dir = path.join(tmpDir, 'com.acme.upgrade')
    expect(fs.existsSync(path.join(dir, 'old-file.js'))).toBe(true)

    await loader.install(makeScext({ ...manifest, version: '2.0.0' }, { 'new-file.js': 'fresh' }))
    expect(fs.existsSync(path.join(dir, 'old-file.js'))).toBe(false)
    expect(fs.existsSync(path.join(dir, 'new-file.js'))).toBe(true)
  })

  it('uninstall() removes the plugin directory', async () => {
    const pluginDir = path.join(tmpDir, 'com.acme.to-remove')
    fs.mkdirSync(pluginDir, { recursive: true })
    fs.writeFileSync(path.join(pluginDir, 'manifest.json'), '{}')

    expect(fs.existsSync(pluginDir)).toBe(true)

    await loader.uninstall('com.acme.to-remove')

    expect(fs.existsSync(pluginDir)).toBe(false)
  })
})
