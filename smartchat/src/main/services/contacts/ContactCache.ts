import { IContactCache } from './IContactCache'

export class ContactCache implements IContactCache {
  private linkCache = new Set<string>()
  private identityIdCache = new Map<string, number>()
  private meJidsCache: string[] | null = null

  clear(): void {
    this.linkCache.clear()
    this.identityIdCache.clear()
    this.meJidsCache = null
  }

  hasLink(key: string): boolean {
    return this.linkCache.has(key)
  }

  addLink(key: string): void {
    this.linkCache.add(key)
  }

  getIdentityId(jid: string): number | undefined {
    return this.identityIdCache.get(jid)
  }

  setIdentityId(jid: string, id: number): void {
    this.identityIdCache.set(jid, id)
  }

  hasIdentityId(jid: string): boolean {
    return this.identityIdCache.has(jid)
  }

  getMeJids(): string[] | null {
    return this.meJidsCache
  }

  setMeJids(jids: string[] | null): void {
    this.meJidsCache = jids
  }

  populateIdentityIdCache(entries: Map<string, number>): void {
    for (const [jid, id] of entries) {
      this.identityIdCache.set(jid, id)
    }
  }
}
