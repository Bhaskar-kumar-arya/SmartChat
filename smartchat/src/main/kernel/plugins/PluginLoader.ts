import * as fs from 'fs'
import * as path from 'path'
import { Worker } from 'node:worker_threads'
import AdmZip from 'adm-zip'
import { PluginManifest, validateManifest, ManifestValidationError } from './PluginManifest'
import { IPluginChannel } from '../channels/IPluginChannel'
import { WorkerPluginChannel } from '../channels/WorkerPluginChannel'
import { IPluginLoader } from './IPluginLoader'

export class PluginLoader implements IPluginLoader {
  constructor(private readonly baseDir: string) {
    if (!fs.existsSync(this.baseDir)) {
      fs.mkdirSync(this.baseDir, { recursive: true })
    }
  }

  async install(scextPath: string): Promise<PluginManifest> {
    if (!fs.existsSync(scextPath)) {
      throw new ManifestValidationError(`Plugin package not found at ${scextPath}`)
    }

    const zip = new AdmZip(scextPath)
    const zipEntries = zip.getEntries()
    const manifestEntry = zipEntries.find((e) => e.entryName === 'manifest.json')

    if (!manifestEntry) {
      throw new ManifestValidationError('manifest.json not found in plugin package')
    }

    let manifestRaw: unknown
    try {
      manifestRaw = JSON.parse(manifestEntry.getData().toString('utf8'))
    } catch {
      throw new ManifestValidationError('manifest.json is not valid JSON')
    }

    const manifest = validateManifest(manifestRaw)

    const pluginDir = path.join(this.baseDir, manifest.id)
    if (!fs.existsSync(pluginDir)) {
      fs.mkdirSync(pluginDir, { recursive: true })
    }

    zip.extractAllTo(pluginDir, true)

    return manifest
  }

  async uninstall(id: string): Promise<void> {
    const pluginDir = path.join(this.baseDir, id)
    if (fs.existsSync(pluginDir)) {
      fs.rmSync(pluginDir, { recursive: true, force: true })
    }
  }

  async load(id: string): Promise<{ manifest: PluginManifest; channel: IPluginChannel }> {
    const pluginDir = path.join(this.baseDir, id)
    const manifestPath = path.join(pluginDir, 'manifest.json')

    if (!fs.existsSync(manifestPath)) {
      throw new ManifestValidationError(`Plugin manifest not found at ${manifestPath}`)
    }

    let manifestRaw: unknown
    try {
      manifestRaw = JSON.parse(fs.readFileSync(manifestPath, 'utf8'))
    } catch {
      throw new ManifestValidationError(`Invalid manifest JSON at ${manifestPath}`)
    }

    const manifest = validateManifest(manifestRaw)

    const entryPath = path.join(pluginDir, manifest.main)
    if (!fs.existsSync(entryPath)) {
      throw new ManifestValidationError(`Plugin entry point not found at ${entryPath}`)
    }

    const worker = new Worker(entryPath)
    const channel = new WorkerPluginChannel(worker, worker)

    return { manifest, channel }
  }

  async reload(id: string): Promise<{ manifest: PluginManifest; channel: IPluginChannel }> {
    return this.load(id)
  }

  async listInstalled(): Promise<PluginManifest[]> {
    if (!fs.existsSync(this.baseDir)) return []

    const entries = fs.readdirSync(this.baseDir, { withFileTypes: true })
    const manifests: PluginManifest[] = []

    for (const entry of entries) {
      if (entry.isDirectory()) {
        const manifestPath = path.join(this.baseDir, entry.name, 'manifest.json')
        if (fs.existsSync(manifestPath)) {
          try {
            const raw = JSON.parse(fs.readFileSync(manifestPath, 'utf8'))
            const manifest = validateManifest(raw)
            manifests.push(manifest)
          } catch {
            // Skip invalid manifests gracefully
          }
        }
      }
    }

    return manifests
  }
}
