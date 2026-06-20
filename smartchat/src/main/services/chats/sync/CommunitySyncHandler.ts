import { ISyncRepository } from '../../sync/ISyncRepository'
import { BaileysGroupMetadata } from '../types'
import { cleanJid, parseCommunityMetadata } from '../../../utils'
import { ICommunitySyncHandler } from './ICommunitySyncHandler'

export class CommunitySyncHandler implements ICommunitySyncHandler {
  constructor(private readonly syncRepository: ISyncRepository) {}

  /**
   * Synchronizes community records and sets up root/announce JID mappings.
   * Returns a map of community JID to database community ID.
   */
  async syncCommunities(
    groups: Record<string, BaileysGroupMetadata>
  ): Promise<Map<string, number>> {
    const groupKeys = Object.keys(groups)
    const rootJids = new Set<string>()
    const announceUpdates: { rootJid: string; announceJid: string }[] = []

    for (const jid of groupKeys) {
      const raw = groups[jid]
      const cleanedJid = cleanJid(jid)
      const commInfo = parseCommunityMetadata(jid, raw)

      if (commInfo.hasCommunityData) {
        const rootJidVal = commInfo.rootJid
        if (rootJidVal) {
          rootJids.add(rootJidVal)
          if (commInfo.isAnnounce) {
            announceUpdates.push({ rootJid: rootJidVal, announceJid: cleanedJid })
          }
        }
      }
    }

    const communityJidToIdMap = new Map<string, number>()
    if (rootJids.size > 0) {
      const allComms = await this.syncRepository.bulkUpsertCommunities(
        Array.from(rootJids).map(rootJid => {
          const name = groups[rootJid]?.name || groups[rootJid]?.subject || null
          return { jid: rootJid, name }
        })
      )
      for (const c of allComms) {
        communityJidToIdMap.set(c.jid, c.id)
      }

      const updates = announceUpdates
        .map(u => {
          const id = communityJidToIdMap.get(u.rootJid)
          return id ? { id, announceJid: u.announceJid } : null
        })
        .filter((x): x is { id: number; announceJid: string } => x !== null)

      if (updates.length > 0) {
        await this.syncRepository.bulkUpdateCommunityAnnounces(updates).catch((err: unknown) => {
          console.error('[CommunitySyncHandler] Failed to transaction-update community announce JIDs:', err)
        })
      }
    }

    return communityJidToIdMap
  }
}
