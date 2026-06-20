import { PrismaClient, Chat, Community, ChatMember, Identity, IdentityAlias, LidMap } from '@prisma/client'
import {
  ISyncRepository,
  SyncChatCreateInput,
  SyncChatUpdateInput,
  SyncLidMapEntry,
  SyncChatMemberUpsert
} from './ISyncRepository'

/**
 * SyncRepository — Encapsulates batch database operations used during high-throughput
 * sync and group hydration operations.
 */
export class SyncRepository implements ISyncRepository {
  constructor(private readonly prisma: PrismaClient) {}

  /**
   * Bulk-upsert community records. Inserts missing communities and returns all of them.
   */
  async bulkUpsertCommunities(
    communities: Array<{ jid: string; name: string | null }>
  ): Promise<Community[]> {
    if (communities.length === 0) return []

    const jids = communities.map(c => c.jid)
    const existing = await this.prisma.community.findMany({
      where: { jid: { in: jids } }
    })
    const existingJids = new Set(existing.map(c => c.jid))

    const missing = communities.filter(c => !existingJids.has(c.jid))
    if (missing.length > 0) {
      await this.prisma.community.createMany({
        data: missing
      })
    }

    return this.prisma.community.findMany({
      where: { jid: { in: jids } }
    })
  }

  /**
   * Bulk-update community announcement JID mappings.
   */
  async bulkUpdateCommunityAnnounces(
    updates: Array<{ id: number; announceJid: string }>
  ): Promise<void> {
    if (updates.length === 0) return

    const ops = updates.map(u =>
      this.prisma.community.update({
        where: { id: u.id },
        data: { announceJid: u.announceJid }
      })
    )

    try {
      await this.prisma.$transaction(ops)
    } catch (err: unknown) {
      console.error('[SyncRepository] Failed to transaction-update community announce JIDs:', err)
      throw err
    }
  }

  /**
   * Find existing chats by their JIDs.
   */
  async findExistingChats(jids: string[]): Promise<Chat[]> {
    if (jids.length === 0) return []
    return this.prisma.chat.findMany({
      where: { jid: { in: jids } }
    })
  }

  /**
   * Bulk-create chat records.
   */
  async bulkCreateChats(chats: SyncChatCreateInput[]): Promise<void> {
    if (chats.length === 0) return
    await this.prisma.chat.createMany({
      data: chats
    })
  }

  /**
   * Bulk-update chat records in a transaction.
   */
  async bulkUpdateChats(chats: SyncChatUpdateInput[]): Promise<void> {
    if (chats.length === 0) return
    const ops = chats.map(c =>
      this.prisma.chat.update({
        where: { jid: c.jid },
        data: c
      })
    )
    await this.prisma.$transaction(ops)
  }

  /**
   * Batch-find multiple aliases.
   */
  async findIdentityAliases(jids: string[]): Promise<IdentityAlias[]> {
    if (jids.length === 0) return []
    return this.prisma.identityAlias.findMany({
      where: { jid: { in: jids } }
    })
  }

  /**
   * Batch-find identities by IDs or phone numbers.
   */
  async findIdentities(ids: number[], phoneNumbers: string[]): Promise<Identity[]> {
    if (ids.length === 0 && phoneNumbers.length === 0) return []
    return this.prisma.identity.findMany({
      where: {
        OR: [
          { id: { in: ids } },
          { phoneNumber: { in: phoneNumbers } }
        ]
      }
    })
  }

  /**
   * Batch-find LidMap records by LID.
   */
  async findLidMaps(lids: string[]): Promise<LidMap[]> {
    if (lids.length === 0) return []
    return this.prisma.lidMap.findMany({
      where: { lid: { in: lids } }
    })
  }

  /**
   * Bulk-create identity records.
   */
  async bulkCreateIdentities(phoneNumbers: string[]): Promise<void> {
    if (phoneNumbers.length === 0) return
    const uniquePns = Array.from(new Set(phoneNumbers))
    const existing = await this.prisma.identity.findMany({
      where: { phoneNumber: { in: uniquePns } },
      select: { phoneNumber: true }
    })
    const existingPns = new Set(existing.map(x => x.phoneNumber).filter((x): x is string => !!x))
    const toInsert = uniquePns.filter(pn => !existingPns.has(pn))
    
    if (toInsert.length > 0) {
      await this.prisma.identity.createMany({
        data: toInsert.map(pn => ({ phoneNumber: pn }))
      })
    }
  }

  /**
   * Batch-find identities by phone numbers.
   */
  async findIdentitiesByPhoneNumbers(phoneNumbers: string[]): Promise<Identity[]> {
    if (phoneNumbers.length === 0) return []
    return this.prisma.identity.findMany({
      where: { phoneNumber: { in: phoneNumbers } }
    })
  }

  /**
   * Create a single identity record.
   */
  async createIdentity(phoneNumber: string | null): Promise<Identity> {
    return this.prisma.identity.create({
      data: { phoneNumber }
    })
  }

  /**
   * Bulk-update identities phone numbers.
   */
  async bulkUpdateIdentities(updates: Array<{ id: number; phoneNumber: string }>): Promise<void> {
    if (updates.length === 0) return
    const ops = updates.map(u =>
      this.prisma.identity.update({
        where: { id: u.id },
        data: { phoneNumber: u.phoneNumber }
      })
    )
    await this.prisma.$transaction(ops)
  }

  /**
   * Bulk-create identity aliases.
   */
  async bulkCreateIdentityAliases(
    aliases: Array<{ jid: string; type: string; identityId: number }>
  ): Promise<void> {
    if (aliases.length === 0) return
    await this.prisma.identityAlias.createMany({
      data: aliases
    })
  }

  /**
   * Bulk-update identity aliases.
   */
  async bulkUpdateIdentityAliases(
    aliases: Array<{ jid: string; identityId: number }>
  ): Promise<void> {
    if (aliases.length === 0) return
    const ops = aliases.map(a =>
      this.prisma.identityAlias.update({
        where: { jid: a.jid },
        data: { identityId: a.identityId }
      })
    )
    await this.prisma.$transaction(ops)
  }

  /**
   * Bulk-upsert LID-to-PN mappings.
   */
  async bulkUpsertLidMaps(entries: SyncLidMapEntry[], existingLids: Set<string>): Promise<void> {
    if (entries.length === 0) return
    const toInsert = entries.filter(e => !existingLids.has(e.lid))
    const toUpdate = entries.filter(e => existingLids.has(e.lid))

    if (toInsert.length > 0) {
      await this.prisma.lidMap.createMany({
        data: toInsert.map(x => ({
          lid: x.lid,
          pn: x.pn,
          source: x.source,
          lastSeenDateTime: BigInt(Math.floor(Date.now() / 1000))
        }))
      })
    }

    if (toUpdate.length > 0) {
      const ops = toUpdate.map(x =>
        this.prisma.lidMap.update({
          where: { lid: x.lid },
          data: {
            pn: x.pn,
            source: x.source,
            lastSeenDateTime: BigInt(Math.floor(Date.now() / 1000))
          }
        })
      )
      await this.prisma.$transaction(ops)
    }
  }

  /**
   * Find existing member records by their chat JIDs.
   */
  async findExistingMemberRoles(chatJids: string[]): Promise<ChatMember[]> {
    if (chatJids.length === 0) return []
    return this.prisma.chatMember.findMany({
      where: { chatJid: { in: chatJids } }
    })
  }

  /**
   * Bulk-upsert chat members. Inserts missing ones and updates those with different roles.
   */
  async bulkUpsertChatMembers(
    members: SyncChatMemberUpsert[],
    existingMemberKeys: Map<string, string>
  ): Promise<void> {
    const toInsert: SyncChatMemberUpsert[] = []
    const toUpdate: SyncChatMemberUpsert[] = []

    for (const m of members) {
      const key = `${m.chatJid}_${m.identityId}`
      const existingRole = existingMemberKeys.get(key)
      if (existingRole === undefined) {
        toInsert.push(m)
      } else if (existingRole !== m.role) {
        toUpdate.push(m)
      }
    }

    if (toInsert.length > 0) {
      await this.prisma.chatMember.createMany({
        data: toInsert
      })
    }

    if (toUpdate.length > 0) {
      const ops = toUpdate.map(m =>
        this.prisma.chatMember.update({
          where: {
            chatJid_identityId: { chatJid: m.chatJid, identityId: m.identityId }
          },
          data: { role: m.role }
        })
      )
      await this.prisma.$transaction(ops)
    }
  }
}
