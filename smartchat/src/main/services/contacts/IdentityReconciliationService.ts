import { PrismaClient } from '@prisma/client'

export class IdentityReconciliationService {
  constructor(
    private prisma: PrismaClient
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

    for (const stub of stubs) {
      const pushName = stub.pushName?.trim()
      if (!pushName || pushName.length < 2) { skipped++; continue }

      // Find PN identities with the same pushName
      const candidates = await this.prisma.identity.findMany({
        where: {
          phoneNumber: { not: null },
          pushName: pushName,
          id: { not: stub.id }
        }
      })

      // Only merge on unambiguous 1:1 match — if 2+ candidates, we can't be sure which is right
      if (candidates.length !== 1) { skipped++; continue }

      const keep = candidates[0]
      const keepId = keep.id
      const stubId = stub.id

      try {
        // 1. Re-point all LID aliases from stub → keep
        await this.prisma.identityAlias.updateMany({
          where: { identityId: stubId },
          data: { identityId: keepId }
        })

        // 2. Re-point messages
        await this.prisma.message.updateMany({
          where: { senderId: stubId },
          data: { senderId: keepId }
        })

        // 3. Merge ChatMember rows — handle composite PK conflicts
        const stubMemberships = await this.prisma.chatMember.findMany({ where: { identityId: stubId } })
        for (const m of stubMemberships) {
          const conflict = await this.prisma.chatMember.findUnique({
            where: { chatJid_identityId: { chatJid: m.chatJid, identityId: keepId } }
          })
          if (conflict) {
            await this.prisma.chatMember.delete({
              where: { chatJid_identityId: { chatJid: m.chatJid, identityId: stubId } }
            })
          } else {
            await this.prisma.chatMember.update({
              where: { chatJid_identityId: { chatJid: m.chatJid, identityId: stubId } },
              data: { identityId: keepId }
            })
          }
        }

        // 4. Merge Reactions — handle composite PK conflicts
        const stubReactions = await this.prisma.reaction.findMany({ where: { senderId: stubId } })
        for (const r of stubReactions) {
          const conflict = await this.prisma.reaction.findUnique({
            where: { messageId_senderId: { messageId: r.messageId, senderId: keepId } }
          })
          if (conflict) {
            await this.prisma.reaction.delete({
              where: { messageId_senderId: { messageId: r.messageId, senderId: stubId } }
            })
          } else {
            await this.prisma.reaction.update({
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
        if (!keep.profilePictureUrl && stub.profilePictureUrl) enrichUpdate.profilePictureUrl = stub.profilePictureUrl
        if (Object.keys(enrichUpdate).length > 0) {
          await this.prisma.identity.update({ where: { id: keepId }, data: enrichUpdate }).catch((err) => {
            console.error(`[deduplicateIdentities] Failed to enrich identity ${keepId} during merge:`, err)
          })
        }

        // 6. Delete the now-empty stub
        await this.prisma.identity.delete({ where: { id: stubId } })

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
}
