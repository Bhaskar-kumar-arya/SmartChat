import { PrismaClient } from '@prisma/client'
import { IContactMutationService } from './IContactService'
import { IIdentityReconciliationService } from './IIdentityReconciliationService'

export class IdentityReconciliationService implements IIdentityReconciliationService {
  constructor(
    private prisma: PrismaClient,
    private contactService: IContactMutationService
  ) {}

  /**
   * Post-sync garbage collector: merges LID-only stubs into their PN counterpart
   * using pushName as the matching heuristic. Only merges when there is exactly
   * one unambiguous PN identity with the same pushName.
   * Safe to call multiple times — fully idempotent.
   */
  async deduplicateIdentities(): Promise<{ merged: number; skipped: number }> {
    let merged = 0
    let skipped = 0

    // Find all LID-only stubs: no phoneNumber, at least one LID alias, non-trivial pushName
    const stubs = await this.prisma.identity.findMany({
      where: {
        phoneNumber: null,
        pushName: { not: null },
        aliases: { some: { type: 'LID' } }
      },
      include: { aliases: true }
    })

    if (stubs.length === 0) {
      return { merged, skipped }
    }

    // Extract all unique non-trivial pushNames to query candidates in bulk
    const pushNames = Array.from(
      new Set(
        stubs
          .map((s) => s.pushName?.trim())
          .filter((name): name is string => typeof name === 'string' && name.length >= 2)
      )
    )

    if (pushNames.length === 0) {
      skipped += stubs.length
      return { merged, skipped }
    }

    // P2-S5-02: pushName is arbitrary user-set text — "Mom", "John", "Papa"
    // collide across unrelated people. Before merging a stub into a PN identity
    // on a bare pushName match, require a corroborating signal: either a LidMap
    // ledger row already links one of the stub's LID aliases to that PN, or the
    // pushName is distinctive (multi-word). Otherwise skip — an automatic,
    // irreversible cross-contact merge on a common first name is data loss.
    const stubLidJids = Array.from(
      new Set(stubs.flatMap((s) => s.aliases.filter((a) => a.type === 'LID').map((a) => a.jid)))
    )
    const lidMapRows = stubLidJids.length
      ? await this.prisma.lidMap.findMany({ where: { lid: { in: stubLidJids } } })
      : []
    const lidToPn = new Map(lidMapRows.map((r) => [r.lid, r.pn]))
    const isDistinctivePushName = (name: string): boolean => /\s/.test(name) && name.trim().length >= 4

    // Find all candidate PN identities with matching pushNames in bulk
    const allCandidates = await this.prisma.identity.findMany({
      where: {
        phoneNumber: { not: null },
        pushName: { in: pushNames }
      }
    })

    // Group candidates by pushName (trimmed matches)
    const candidatesMap = new Map<string, typeof allCandidates>()
    for (const candidate of allCandidates) {
      if (candidate.pushName) {
        const key = candidate.pushName.trim()
        let group = candidatesMap.get(key)
        if (!group) {
          group = []
          candidatesMap.set(key, group)
        }
        group.push(candidate)
      }
    }

    for (const stub of stubs) {
      const pushName = stub.pushName?.trim()
      if (!pushName || pushName.length < 2) {
        skipped++
        continue
      }

      const matchCandidates = candidatesMap.get(pushName) ?? []

      // Only merge on unambiguous 1:1 match — if 2+ candidates, we can't be sure which is right
      if (matchCandidates.length !== 1) {
        skipped++
        continue
      }

      const keep = matchCandidates[0]
      const keepId = keep.id
      const stubId = stub.id

      // P2-S5-02: gate the merge on a corroborating signal (see above).
      const corroborated = stub.aliases.some(
        (a) => a.type === 'LID' && keep.phoneNumber && lidToPn.get(a.jid) === keep.phoneNumber
      )
      if (!corroborated && !isDistinctivePushName(pushName)) {
        console.log(
          `[deduplicateIdentities] Skipped stub id=${stubId} ("${pushName}") — pushName match not corroborated (common/short name)`
        )
        skipped++
        continue
      }

      try {
        // Steps 1-6 run in a single interactive transaction so a mid-merge
        // failure (lock contention, FK/unique conflict, or a concurrent
        // history-sync write re-adding a child row) rolls back to the
        // pre-merge state instead of leaving a dangling half-merged stub.
        await this.prisma.$transaction(async (tx) => {
          // 1. Re-point all LID aliases from stub → keep
          await tx.identityAlias.updateMany({
            where: { identityId: stubId },
            data: { identityId: keepId }
          })

          // 2. Re-point messages
          await tx.message.updateMany({
            where: { senderId: stubId },
            data: { senderId: keepId }
          })

          // 3. Merge ChatMember rows — handle composite PK conflicts
          const stubMemberships = await tx.chatMember.findMany({ where: { identityId: stubId } })
          for (const m of stubMemberships) {
            const conflict = await tx.chatMember.findUnique({
              where: { chatJid_identityId: { chatJid: m.chatJid, identityId: keepId } }
            })
            if (conflict) {
              await tx.chatMember.delete({
                where: { chatJid_identityId: { chatJid: m.chatJid, identityId: stubId } }
              })
            } else {
              await tx.chatMember.update({
                where: { chatJid_identityId: { chatJid: m.chatJid, identityId: stubId } },
                data: { identityId: keepId }
              })
            }
          }

          // 4. Merge Reactions — handle composite PK conflicts
          const stubReactions = await tx.reaction.findMany({ where: { senderId: stubId } })
          for (const r of stubReactions) {
            const conflict = await tx.reaction.findUnique({
              where: { messageId_senderId: { messageId: r.messageId, senderId: keepId } }
            })
            if (conflict) {
              await tx.reaction.delete({
                where: { messageId_senderId: { messageId: r.messageId, senderId: stubId } }
              })
            } else {
              await tx.reaction.update({
                where: { messageId_senderId: { messageId: r.messageId, senderId: stubId } },
                data: { senderId: keepId }
              })
            }
          }

          // 5. Enrich the survivor with any unique data the stub held
          const enrichUpdate: {
            displayName?: string | null
            verifiedName?: string | null
            profilePictureUrl?: string | null
          } = {}
          if (!keep.displayName && stub.displayName) enrichUpdate.displayName = stub.displayName
          if (!keep.verifiedName && stub.verifiedName) enrichUpdate.verifiedName = stub.verifiedName
          if (!keep.profilePictureUrl && stub.profilePictureUrl)
            enrichUpdate.profilePictureUrl = stub.profilePictureUrl
          if (Object.keys(enrichUpdate).length > 0) {
            await tx.identity.update({ where: { id: keepId }, data: enrichUpdate })
          }

          // 6. Delete the now-empty stub
          await tx.identity.delete({ where: { id: stubId } })
        })

        merged++
        console.log(`[deduplicateIdentities] Merged stub id=${stubId} ("${pushName}") → id=${keepId} (${keep.phoneNumber})`)
      } catch (err) {
        console.warn(`[deduplicateIdentities] Failed to merge stub id=${stubId}:`, err)
        skipped++
      }
    }

    console.log(`[deduplicateIdentities] Complete — merged: ${merged}, skipped: ${skipped} (ambiguous/no-match)`)
    return { merged, skipped }
  }

  /**
   * Reconciles Lid and Pn mappings from potential JIDs.
   */
  async reconcileLidPnFromJids(
    potentialIds: (string | null | undefined)[],
    source: string
  ): Promise<void> {
    let discoveredLid: string | null = null
    let discoveredPn: string | null = null
    for (const id of potentialIds) {
      if (typeof id === 'string') {
        if (id.includes('@lid')) discoveredLid = id
        if (id.includes('@s.whatsapp.net')) discoveredPn = id
      }
    }
    if (discoveredLid && discoveredPn) {
      await this.contactService
        .linkLidAndPn(discoveredLid, discoveredPn, source)
        .catch((err: unknown) => {
          console.error(`[IdentityReconciliationService] Failed to link LID and PN for source ${source}:`, err)
        })
    }
  }
}

