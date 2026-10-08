import NodeCache from 'node-cache'
import type { GroupMetadata, GroupParticipant, ParticipantAction, WASocket } from '@whiskeysockets/baileys'

const DEFAULT_TTL_SECONDS = 5 * 60

interface ParticipantsUpdate {
  id: string
  participants: GroupParticipant[]
  action: ParticipantAction
}

/**
 * Long-lived, worker-side group metadata cache (B-WA-08 / R-WA-10).
 *
 * Baileys consults `cachedGroupMetadata` on every group send and retry; on a miss it sends a
 * `groupMetadata` IQ, which is the rate-limit pattern the option exists to prevent. The cache
 * outlives individual sockets (it is owned by WorkerConnectionManager) and is filled from
 * `groupFetchAllParticipating`, `groupMetadata`, `groups.upsert`/`groups.update` and kept
 * correct by `group-participants.update`.
 */
export class WorkerGroupCache {
  private readonly cache: NodeCache

  constructor(ttlSeconds: number = DEFAULT_TTL_SECONDS) {
    this.cache = new NodeCache({ stdTTL: ttlSeconds, useClones: false })
  }

  public get(jid: string): GroupMetadata | undefined {
    return this.cache.get<GroupMetadata>(jid)
  }

  public set(meta: GroupMetadata): void {
    if (meta?.id) this.cache.set(meta.id, meta)
  }

  public setAll(groups: Record<string, GroupMetadata> | GroupMetadata[] | null | undefined): void {
    if (!groups) return
    for (const meta of Object.values(groups)) this.set(meta)
  }

  public delete(jid: string): void {
    this.cache.del(jid)
  }

  public clear(): void {
    this.cache.flushAll()
  }

  /** Merge a partial `groups.update`. A partial for an uncached group is only stored if complete. */
  public applyUpdate(update: Partial<GroupMetadata>): void {
    if (!update?.id) return
    const existing = this.get(update.id)
    if (existing) {
      this.cache.set(update.id, { ...existing, ...update })
    } else if (Array.isArray(update.participants)) {
      this.cache.set(update.id, update as GroupMetadata)
    }
  }

  /** Apply a `group-participants.update`. Uncached groups are left to be fetched fresh. */
  public applyParticipantsUpdate({ id, participants, action }: ParticipantsUpdate): void {
    const existing = this.get(id)
    if (!existing) return
    const changed = new Set(participants.map((p) => p.id))
    let next: GroupParticipant[] = existing.participants ?? []
    switch (action) {
      case 'add': {
        const have = new Set(next.map((p) => p.id))
        next = [...next, ...participants.filter((p) => !have.has(p.id))]
        break
      }
      case 'remove':
        next = next.filter((p) => !changed.has(p.id))
        break
      case 'promote':
        next = next.map((p) =>
          changed.has(p.id) ? { ...p, admin: 'admin', isAdmin: true } : p
        )
        break
      case 'demote':
        next = next.map((p) =>
          changed.has(p.id) ? { ...p, admin: null, isAdmin: false, isSuperAdmin: false } : p
        )
        break
      default:
        // 'modify' (and anything unknown): we cannot reconstruct the result, refetch lazily.
        this.cache.del(id)
        return
    }
    this.cache.set(id, { ...existing, participants: next, size: next.length })
  }

  /** Wire the cache to a socket: event listeners plus fill-on-fetch wrappers. */
  public attach(sock: WASocket): void {
    sock.ev.on('groups.upsert', (groups): void => this.setAll(groups))
    sock.ev.on('groups.update', (updates): void => {
      for (const u of updates) this.applyUpdate(u)
    })
    sock.ev.on('group-participants.update', (u): void => this.applyParticipantsUpdate(u))

    const fetchAll = sock.groupFetchAllParticipating?.bind(sock)
    if (fetchAll) {
      sock.groupFetchAllParticipating = async (): Promise<Record<string, GroupMetadata>> => {
        const groups = await fetchAll()
        this.setAll(groups)
        return groups
      }
    }
    const fetchOne = sock.groupMetadata?.bind(sock)
    if (fetchOne) {
      sock.groupMetadata = async (jid: string): Promise<GroupMetadata> => {
        const meta = await fetchOne(jid)
        this.set(meta)
        return meta
      }
    }
  }
}
