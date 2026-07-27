import { ContributionMap, ContributionSlot } from './ContributionPoints'
import { IContributionRegistry } from './IContributionRegistry'

export class ContributionRegistry implements IContributionRegistry {
  private readonly storage = new Map<ContributionSlot, ContributionMap[ContributionSlot][]>()
  private readonly listeners = new Set<() => void>()

  public register<K extends ContributionSlot>(
    slot: K,
    contribution: ContributionMap[K]
  ): void {
    const list = this.storage.get(slot) ?? []
    list.push(contribution)
    this.storage.set(slot, list)
    this.notifyListeners()
  }

  public unregisterAll(pluginId: string): void {
    let changed = false
    for (const [slot, list] of this.storage.entries()) {
      const filtered = list.filter((item) => item.pluginId !== pluginId)
      if (filtered.length !== list.length) {
        this.storage.set(slot, filtered)
        changed = true
      }
    }

    if (changed) {
      this.notifyListeners()
    }
  }

  public getAll<K extends ContributionSlot>(slot: K): ContributionMap[K][] {
    const list = this.storage.get(slot)
    if (!list) {
      return []
    }
    return list.slice() as ContributionMap[K][]
  }

  public getAllSlots(): ContributionSlot[] {
    return Array.from(this.storage.keys())
  }

  public onChange(handler: () => void): () => void {
    this.listeners.add(handler)
    return () => {
      this.listeners.delete(handler)
    }
  }

  private notifyListeners(): void {
    for (const listener of this.listeners) {
      try {
        listener()
      } catch (err: unknown) {
        console.error('[ContributionRegistry] Listener threw error:', err)
      }
    }
  }
}
