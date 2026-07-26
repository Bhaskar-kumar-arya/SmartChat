import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import * as fs from 'fs'
import * as path from 'path'
import * as os from 'os'
import AdmZip from 'adm-zip'
import { PluginLoader } from '../../../kernel/plugins/PluginLoader'
import { ApiVersionError } from '../../../kernel/plugins/PluginManifest'

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

  it('uninstall() removes the plugin directory', async () => {
    const pluginDir = path.join(tmpDir, 'com.acme.to-remove')
    fs.mkdirSync(pluginDir, { recursive: true })
    fs.writeFileSync(path.join(pluginDir, 'manifest.json'), '{}')

    expect(fs.existsSync(pluginDir)).toBe(true)

    await loader.uninstall('com.acme.to-remove')

    expect(fs.existsSync(pluginDir)).toBe(false)
  })
})
