import { cleanJid } from '../../utils/jidUtils'
import { IIdentityRepository } from './IIdentityRepository'
import { IAliasRepository } from './IAliasRepository'
import { ILidMapRepository } from './ILidMapRepository'
import { ILidPnLinker } from './ILidPnLinker'

export class LidPnLinker implements ILidPnLinker {
  constructor(
    private readonly identityRepository: IIdentityRepository,
    private readonly aliasRepository: IAliasRepository,
    private readonly lidMapRepository: ILidMapRepository
  ) { }

  /**
   * Links a LID to a PN explicitly (e.g., from lid-mapping.update events).
   */
  async linkLidAndPn(
    lid: string,
    pn: string,
    source: string,
    isAlreadyLinked?: (lid: string, pn: string) => boolean,
    onLinked?: (lid: string, pn: string, identityId: number) => void
  ): Promise<void> {
    const cleanLid = cleanJid(lid)
    const cleanPn = cleanJid(pn)
    if (!cleanLid || !cleanPn) return

    if (isAlreadyLinked && isAlreadyLinked(cleanLid, cleanPn)) {
      return
    }

    // P2-S5-06: do the relational identity sync FIRST, then write the mapping
    // ledger row. Writing the ledger first meant a failure in the relational
    // sync left `LidMap` claiming lid↔pn are linked (so `isAlreadyLinked`
    // short-circuits every future attempt) while the identities were never
    // actually merged — a permanent split contact. Ledger-last keeps a failure
    // retryable.

    // 1. Relational Identity Sync
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
      await this.repointLidToIdentity(cleanLid, identityId, lidAlias?.identityId ?? null)
    } else if (lidAlias) {
      identityId = lidAlias.identityId
      try {
        // Update the identity to have the phone number
        await this.identityRepository.updateIdentity(identityId, { phoneNumber: cleanPn })
        await this.aliasRepository.upsertIdentityAlias(cleanPn, 'PN', identityId)
      } catch (err) {
        // A concurrent link claimed this phoneNumber first: fold the stub into it.
        const winner = isUniqueViolation(err) ? await this.identityRepository.findIdentityByPhoneNumber(cleanPn) : null
        if (!winner) throw err
        identityId = winner.id
        await this.repointLidToIdentity(cleanLid, identityId, lidAlias.identityId)
      }
    } else {
      // Neither exists, create a new identity and both aliases
      try {
        identityId = (await this.identityRepository.createIdentity({ phoneNumber: cleanPn })).id
      } catch (err) {
        // Burst of lid-mapping.update after pairing: a concurrent link created the
        // identity between our lookup and create. Reuse it instead of failing (P2002).
        const winner = isUniqueViolation(err) ? await this.identityRepository.findIdentityByPhoneNumber(cleanPn) : null
        if (!winner) throw err
        identityId = winner.id
      }
      await this.aliasRepository.upsertIdentityAlias(cleanPn, 'PN', identityId)
      await this.aliasRepository.upsertIdentityAlias(cleanLid, 'LID', identityId)
    }

    // 2. High-Performance Mapping Ledger — written last so a relational-sync
    // failure above leaves this retryable (P2-S5-06).
    await this.lidMapRepository.upsertLidMap(cleanLid, cleanPn, source).catch((err: unknown) => {
      console.error('[LidPnLinker] Failed to upsert lidMap entry:', err)
    })

    if (onLinked) {
      onLinked(cleanLid, cleanPn, identityId)
    }
  }

  /**
   * Re-points `lid` to the canonical identity and disposes of the identity that
   * previously held it. A LID-only stub (no phoneNumber) is merged wholesale so its
   * messages, reactions and memberships follow (B-DATA-01); any other orphan keeps
   * the legacy behaviour (delete only when nothing references it).
   */
  private async repointLidToIdentity(lid: string, identityId: number, orphanId: number | null): Promise<void> {
    const orphan = orphanId !== null && orphanId !== identityId ? await this.identityRepository.findIdentityById(orphanId) : null

    if (orphan && !orphan.phoneNumber) {
      await this.identityRepository.mergeIdentityInto(orphan.id, identityId)
    }

    // Idempotent after a merge (the alias already moved); required when there was no stub.
    await this.aliasRepository.upsertIdentityAlias(lid, 'LID', identityId)

    if (orphan && orphan.phoneNumber) {
      const { aliases, messages, members, reactions } = await this.identityRepository.countIdentityReferences(orphan.id)
      if (aliases === 0 && messages === 0 && members === 0 && reactions === 0) {
        await this.identityRepository.deleteIdentity(orphan.id).catch((err: unknown) => {
          console.error('[LidPnLinker] Failed to delete orphaned identity:', err)
        })
      }
    }
  }
}

function isUniqueViolation(err: unknown): boolean {
  return typeof err === 'object' && err !== null && (err as { code?: string }).code === 'P2002'
}
