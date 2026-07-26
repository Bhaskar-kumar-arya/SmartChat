import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs'
import { dirname } from 'path'
import { IPermissionStore, PermissionScope, PluginPermissionState } from './IPermissionStore'

interface PersistedPermissionData {
  plugins: Record<string, {
    capabilities: Record<string, { granted: boolean; scope?: PermissionScope }>
  }>
}

export class PermissionStore implements IPermissionStore {
  private readonly manifestCapabilities = new Map<string, Set<string>>()
  private storageData: PersistedPermissionData = { plugins: {} }

  constructor(private readonly storageFilePath?: string) {
    this.loadFromDisk()
  }

  public registerPluginManifest(pluginId: string, capabilities: string[]): void {
    this.manifestCapabilities.set(pluginId, new Set(capabilities))
  }

  public hasCapability(pluginId: string, capability: string): boolean {
    const manifestSet = this.manifestCapabilities.get(pluginId)
    if (!manifestSet || !manifestSet.has(capability)) {
      return false
    }

    const pluginConfig = this.storageData.plugins[pluginId]?.capabilities[capability]
    if (pluginConfig && pluginConfig.granted === false) {
      return false
    }

    return true
  }

  public isResourceAllowed(pluginId: string, capability: string, resourceId: string): boolean {
    const pluginConfig = this.storageData.plugins[pluginId]?.capabilities[capability]
    const scope = pluginConfig?.scope

    if (!scope) {
      return true
    }

    if (scope.deny && scope.deny.includes(resourceId)) {
      return false
    }

    if (scope.allow && scope.allow.length > 0) {
      return scope.allow.includes(resourceId)
    }

    return true
  }

  public async setCapability(pluginId: string, capability: string, granted: boolean): Promise<void> {
    this.ensurePluginRecord(pluginId)
    const current = this.storageData.plugins[pluginId].capabilities[capability] ?? { granted: true }
    current.granted = granted
    this.storageData.plugins[pluginId].capabilities[capability] = current
    this.saveToDisk()
  }

  public async setScope(pluginId: string, capability: string, scope: PermissionScope): Promise<void> {
    this.ensurePluginRecord(pluginId)
    const current = this.storageData.plugins[pluginId].capabilities[capability] ?? { granted: true }
    current.scope = scope
    this.storageData.plugins[pluginId].capabilities[capability] = current
    this.saveToDisk()
  }

  public getPluginPermissions(pluginId: string): PluginPermissionState {
    const declared = this.manifestCapabilities.get(pluginId) ?? new Set()
    const stored = this.storageData.plugins[pluginId]?.capabilities ?? {}

    const capabilitiesState: Record<string, { granted: boolean; scope?: PermissionScope }> = {}

    for (const cap of declared) {
      const saved = stored[cap]
      capabilitiesState[cap] = {
        granted: saved ? saved.granted : true,
        ...(saved?.scope ? { scope: saved.scope } : {})
      }
    }

    // Also include any saved capabilities not in current manifest
    for (const [cap, saved] of Object.entries(stored)) {
      if (!capabilitiesState[cap]) {
        capabilitiesState[cap] = {
          granted: saved.granted,
          ...(saved.scope ? { scope: saved.scope } : {})
        }
      }
    }

    return {
      pluginId,
      capabilities: capabilitiesState
    }
  }

  private ensurePluginRecord(pluginId: string): void {
    if (!this.storageData.plugins[pluginId]) {
      this.storageData.plugins[pluginId] = { capabilities: {} }
    }
  }

  private loadFromDisk(): void {
    if (!this.storageFilePath) return

    try {
      if (existsSync(this.storageFilePath)) {
        const raw = readFileSync(this.storageFilePath, 'utf-8')
        this.storageData = JSON.parse(raw)
      }
    } catch (err: unknown) {
      console.error('[PermissionStore] Failed to load permissions from disk:', err)
      this.storageData = { plugins: {} }
    }
  }

  private saveToDisk(): void {
    if (!this.storageFilePath) return

    try {
      const dir = dirname(this.storageFilePath)
      if (!existsSync(dir)) {
        mkdirSync(dir, { recursive: true })
      }
      writeFileSync(this.storageFilePath, JSON.stringify(this.storageData, null, 2), 'utf-8')
    } catch (err: unknown) {
      console.error('[PermissionStore] Failed to save permissions to disk:', err)
    }
  }
}
