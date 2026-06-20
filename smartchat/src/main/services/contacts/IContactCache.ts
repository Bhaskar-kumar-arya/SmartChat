export interface IContactCache {
  clear(): void
  hasLink(key: string): boolean
  addLink(key: string): void
  getIdentityId(jid: string): number | undefined
  setIdentityId(jid: string, id: number): void
  hasIdentityId(jid: string): boolean
  getMeJids(): string[] | null
  setMeJids(jids: string[] | null): void
  populateIdentityIdCache(entries: Map<string, number>): void
}
