import * as fs from 'fs'
import * as path from 'path'
import AdmZip from 'adm-zip'
import { IExtensionLoader, ExtensionModule } from './IExtensionLoader'
import { ExtensionManifest } from '../types/ExtensionManifest'
import { ApiVersionError, ExtensionLoadError, ManifestValidationError } from '../types/ExtensionErrors'

const SUPPORTED_API_VERSIONS = ['1']

export class ExtensionLoader implements IExtensionLoader {
  private baseDir: string

  constructor(baseDir: string) {
    this.baseDir = baseDir
    if (!fs.existsSync(this.baseDir)) {
      fs.mkdirSync(this.baseDir, { recursive: true })
    }
  }

  async install(scextPath: string): Promise<ExtensionManifest> {
    if (!fs.existsSync(scextPath)) {
      throw new ExtensionLoadError(`File not found: ${scextPath}`)
    }

    // Use a temporary extraction to get the manifest and check id
    const zip = new AdmZip(scextPath)
    const zipEntries = zip.getEntries()
    const manifestEntry = zipEntries.find((entry) => entry.entryName === 'manifest.json')
    
    if (!manifestEntry) {
      throw new ManifestValidationError('manifest.json not found in the extension package')
    }

    const manifestStr = manifestEntry.getData().toString('utf8')
    let manifest: Partial<ExtensionManifest>
    try {
      manifest = JSON.parse(manifestStr)
    } catch (e) {
      throw new ManifestValidationError('manifest.json is not valid JSON')
    }

    if (!manifest.id || typeof manifest.id !== 'string') {
      throw new ManifestValidationError('Extension manifest is missing a valid string "id"')
    }

    const extensionDir = path.join(this.baseDir, manifest.id)
    if (!fs.existsSync(extensionDir)) {
      fs.mkdirSync(extensionDir, { recursive: true })
    }

    // Extract all files to extension directory
    zip.extractAllTo(extensionDir, true)

    return this.parseAndValidateManifest(extensionDir)
  }

  async uninstall(id: string): Promise<void> {
    const extensionDir = path.join(this.baseDir, id)
    if (fs.existsSync(extensionDir)) {
      fs.rmSync(extensionDir, { recursive: true, force: true })
    }
  }

  async load(id: string): Promise<ExtensionModule> {
    const extensionDir = path.join(this.baseDir, id)
    const manifest = await this.parseAndValidateManifest(extensionDir)
    
    const entryPath = path.join(extensionDir, manifest.main)
    if (!fs.existsSync(entryPath)) {
      throw new ExtensionLoadError(`Entry point not found: ${entryPath}`)
    }

    try {
      // Dynamic import or require depending on how it's built. Assuming CommonJS requires for now.
      const mod = require(entryPath)
      const isFunction = typeof mod === 'function'
      const hasActivate = mod && typeof mod.activate === 'function'
      
      if (!isFunction && !hasActivate) {
        throw new ExtensionLoadError('Extension module must export a function or an object with an activate function')
      }
      
      return mod as ExtensionModule
    } catch (e: any) {
      throw new ExtensionLoadError(`Failed to load extension module: ${e.message}`)
    }
  }

  async reload(id: string): Promise<ExtensionModule> {
    const extensionDir = path.join(this.baseDir, id)
    // Clear require cache for all files in this directory
    Object.keys(require.cache).forEach((key) => {
      if (key.startsWith(extensionDir)) {
        delete require.cache[key]
      }
    })
    return this.load(id)
  }

  async listInstalled(): Promise<ExtensionManifest[]> {
    if (!fs.existsSync(this.baseDir)) return []
    
    const entries = fs.readdirSync(this.baseDir, { withFileTypes: true })
    const manifests: ExtensionManifest[] = []
    
    for (const entry of entries) {
      if (entry.isDirectory()) {
        try {
          const manifest = await this.parseAndValidateManifest(path.join(this.baseDir, entry.name))
          manifests.push(manifest)
        } catch (e) {
          // Ignore invalid extensions in the directory
          console.warn(`Failed to parse manifest for extension ${entry.name}:`, e)
        }
      }
    }
    
    return manifests
  }

  private async parseAndValidateManifest(extensionDir: string): Promise<ExtensionManifest> {
    const manifestPath = path.join(extensionDir, 'manifest.json')
    if (!fs.existsSync(manifestPath)) {
      throw new ManifestValidationError(`manifest.json not found at ${manifestPath}`)
    }

    const manifestStr = fs.readFileSync(manifestPath, 'utf-8')
    let manifest: ExtensionManifest
    try {
      manifest = JSON.parse(manifestStr)
    } catch (e) {
      throw new ManifestValidationError('manifest.json is not valid JSON')
    }

    if (!manifest.id || typeof manifest.id !== 'string') throw new ManifestValidationError('Missing or invalid id')
    if (!manifest.version || typeof manifest.version !== 'string') throw new ManifestValidationError('Missing or invalid version')
    if (!manifest.apiVersion || typeof manifest.apiVersion !== 'string') throw new ManifestValidationError('Missing or invalid apiVersion')
    if (!manifest.name || typeof manifest.name !== 'string') throw new ManifestValidationError('Missing or invalid name')
    if (!manifest.description || typeof manifest.description !== 'string') throw new ManifestValidationError('Missing or invalid description')
    if (!manifest.main || typeof manifest.main !== 'string') throw new ManifestValidationError('Missing or invalid main')
    if (!Array.isArray(manifest.permissions)) throw new ManifestValidationError('Permissions must be an array')

    if (!SUPPORTED_API_VERSIONS.includes(manifest.apiVersion)) {
      throw new ApiVersionError(`Unsupported API version: ${manifest.apiVersion}. Supported versions: ${SUPPORTED_API_VERSIONS.join(', ')}`)
    }

    return manifest
  }
}
