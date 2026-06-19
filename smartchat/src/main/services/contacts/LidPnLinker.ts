import { cleanJid } from '../../utils'
import { IIdentityRepository } from './IIdentityRepository'
import { IAliasRepository } from './IAliasRepository'
import { ILidMapRepository } from './ILidMapRepository'

export class LidPnLinker {
  constructor(
    private readonly identityRepository: IIdentityRepository,
    private readonly aliasRepository: IAliasRepository,
    private readonly lidMapRepository: ILidMapRepository
  ) {}

  /**
   * Links a LID to a PN explicitly (e.g., from lid-mapping.update events).
   */
  async linkLidAndPn(
    lid: string,
    pn: string,
    source: string,
    linkCache: Set<string>,
    identityIdCache: Map<string, number>
  ): Promise<void> {
    const cleanLid = cleanJid(lid)
    const cleanPn = cleanJid(pn)
    if (!cleanLid || !cleanPn) return

    const cacheKey = `${cleanLid}->${cleanPn}`
    if (linkCache.has(cacheKey)) {
      return
    }

    // 1. High-Performance Mapping Ledger
    await this.lidMapRepository.upsertLidMap(cleanLid, cleanPn, source).catch((err: unknown) => {
      console.error('[LidPnLinker] Failed to upsert lidMap entry:', err)
    })

    // 2. Relational Identity Sync
    // Find identities for both
    const lidAlias = await this.aliasRepository.findIdentityAlias(cleanLid)
    let pnIdentity = await this.identityRepository.findIdentityByPhoneNumber(cleanPn)
    
    if (!pnIdentity) {
      // Look for PN alias
      const pnAlias = await this.aliasRepository.findIdentityAlias(cleanPn)
      if (pnAlias) {
        pnIdentity = await this.identityRepository.findIdentityById(pnAlias.identityId)
      }
    }

    let identityId: number

    if (pnIdentity) {
      identityId = pnIdentity.id
      const orphanId = lidAlias && lidAlias.identityId !== identityId ? lidAlias.identityId : null

      // Re-point the LID alias to the canonical PN identity
      await this.aliasRepository.upsertIdentityAlias(cleanLid, 'LID', identityId)

      // Delete the old LID-only stub if nothing else references it
      if (orphanId) {
        const { aliases: aliasCount, messages: msgCount, members: memberCount, reactions: reactionCount } = 
          await this.identityRepository.countIdentityReferences(orphanId)

        if (aliasCount === 0 && msgCount === 0 && memberCount === 0 && reactionCount === 0) {
          await this.identityRepository.deleteIdentity(orphanId).catch((err: unknown) => {
            console.error('[LidPnLinker] Failed to delete orphaned identity:', err)
          })
        }
      }
    } else if (lidAlias) {
      identityId = lidAlias.identityId
      // Update the identity to have the phone number
      await this.identityRepository.updateIdentity(identityId, { phoneNumber: cleanPn })
      await this.aliasRepository.upsertIdentityAlias(cleanPn, 'PN', identityId)
    } else {
      // Neither exists, create a new identity and both aliases
      const newId = await this.identityRepository.createIdentity({ phoneNumber: cleanPn })
      identityId = newId.id
      await this.aliasRepository.upsertIdentityAlias(cleanPn, 'PN', identityId)
      await this.aliasRepository.upsertIdentityAlias(cleanLid, 'LID', identityId)
    }

    identityIdCache.set(cleanLid, identityId)
    identityIdCache.set(cleanPn, identityId)
    linkCache.add(cacheKey)
  }
}
