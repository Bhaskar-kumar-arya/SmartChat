export interface PermissionScope {
  /** Explicit allow-list of resource IDs (JIDs, tool names, etc.). Empty = all allowed. */
  allow?: string[]
  /** Explicit deny-list. Applied after allow. */
  deny?: string[]
}

export interface PluginPermissionState {
  pluginId: string
  capabilities: Record<string, { granted: boolean; scope?: PermissionScope }>
}

export interface IPermissionStore {
  /** Register capabilities declared by a plugin manifest */
  registerPluginManifest(pluginId: string, capabilities: string[]): void
  /** Coarse check: does this plugin have this capability at all? */
  hasCapability(pluginId: string, capability: string): boolean
  /**
   * Fine-grained check: is this specific resource ID allowed for this capability?
   * Returns true if no scope is configured (default-allow).
   */
  isResourceAllowed(pluginId: string, capability: string, resourceId: string): boolean
  /** Persist a permission toggle from the user's Settings UI. */
  setCapability(pluginId: string, capability: string, granted: boolean): Promise<void>
  /** Persist a scope restriction. */
  setScope(pluginId: string, capability: string, scope: PermissionScope): Promise<void>
  /** Return full permission state for a plugin (used by Settings UI). */
  getPluginPermissions(pluginId: string): PluginPermissionState
}
