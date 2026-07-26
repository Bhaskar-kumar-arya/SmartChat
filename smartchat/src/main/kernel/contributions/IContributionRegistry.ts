import { ContributionMap, ContributionSlot } from './ContributionPoints'

export interface IContributionRegistry {
  /** Register a contribution. Called by plugins during activation. */
  register<K extends ContributionSlot>(
    slot: K,
    contribution: ContributionMap[K]
  ): void
  /** Remove all contributions from a given plugin. Called on unload. */
  unregisterAll(pluginId: string): void
  /** Get all contributions for a slot. Used by the renderer and kernel. */
  getAll<K extends ContributionSlot>(slot: K): ContributionMap[K][]
  /**
   * Subscribe to changes. Fires whenever any plugin registers or unregisters.
   * The kernel pushes snapshots to the renderer over IPC whenever this fires.
   */
  onChange(handler: () => void): () => void
}
