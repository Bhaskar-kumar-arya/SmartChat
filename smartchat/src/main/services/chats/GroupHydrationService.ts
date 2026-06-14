import { PrismaClient } from '@prisma/client'
import { ContactService } from '../contacts/ContactService'
import { cleanJid, parseBaileysTimestamp, parseCommunityMetadata } from '../../utils'

export class GroupHydrationService {
  constructor(
    private prisma: PrismaClient,
    private contactService: ContactService
  ) {}

  /**
   * Bulk-hydrates groups and participants by batching DB reads and writes.
   * Reports progress using the provided callback.
   */
  async hydrateGroups(
    groups: Record<string, any>,
    onProgress?: (progress: number, status: string) => void
  ): Promise<void> {
    const groupKeys = Object.keys(groups)
    const totalGroups = groupKeys.length
    if (totalGroups === 0) return

    const BATCH_SIZE = 25
    let processedCount = 0

    for (let i = 0; i < totalGroups; i += BATCH_SIZE) {
      const batchKeys = groupKeys.slice(i, i + BATCH_SIZE)
      const batchGroups: Record<string, any> = {}
      for (const k of batchKeys) {
        batchGroups[k] = groups[k]
      }

      await this.hydrateBatch(batchGroups)

      processedCount += batchKeys.length
      if (onProgress) {
        const progressVal = 95 + Math.round((processedCount / totalGroups) * 4)
        onProgress(progressVal, `Syncing group members... (${processedCount} / ${totalGroups})`)
      }
      await new Promise(r => setImmediate(r))
    }
  }

  private async hydrateBatch(groups: Record<string, any>): Promise<void> {
    const groupKeys = Object.keys(groups)
    const allGroupJids = groupKeys.map(cleanJid).filter(Boolean)
    if (allGroupJids.length === 0) return

    // --- PHASE 1: Communities ---
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
      const existingComms = await this.prisma.community.findMany({
        where: { jid: { in: Array.from(rootJids) } }
      })
      const existingCommsSet = new Set(existingComms.map(c => c.jid))
      
      const missingComms: { jid: string; name: string | null }[] = []
      for (const rootJid of rootJids) {
        if (!existingCommsSet.has(rootJid)) {
          const name = groups[rootJid]?.name || groups[rootJid]?.subject || null
          missingComms.push({ jid: rootJid, name })
        }
      }

      if (missingComms.length > 0) {
        await this.prisma.community.createMany({
          data: missingComms
        })
      }

      const allComms = await this.prisma.community.findMany({
        where: { jid: { in: Array.from(rootJids) } }
      })
      for (const c of allComms) {
        communityJidToIdMap.set(c.jid, c.id)
      }

      const commAnnounceUpdates: any[] = []
      for (const update of announceUpdates) {
        const commId = communityJidToIdMap.get(update.rootJid)
        if (commId) {
          commAnnounceUpdates.push(
            this.prisma.community.update({
              where: { id: commId },
              data: { announceJid: update.announceJid }
            })
          )
        }
      }
      if (commAnnounceUpdates.length > 0) {
        await this.prisma.$transaction(commAnnounceUpdates).catch(() => {})
      }
    }

    // --- PHASE 2: Chats Upsert ---
    const existingChats = await this.prisma.chat.findMany({
      where: { jid: { in: allGroupJids } }
    })
    const existingChatsMap = new Map(existingChats.map(c => [c.jid, c]))

    const chatsToInsert: any[] = []
    const chatsToUpdate: any[] = []

    for (const jid of groupKeys) {
      const raw = groups[jid]
      const cleanedJid = cleanJid(jid)
      const chatName = raw.name || raw.subject || null

      const ts = raw.conversationTimestamp ?? raw.timestamp
      const hasTimestamp = ts !== undefined && ts !== null
      const timestamp = hasTimestamp ? parseBaileysTimestamp(ts) : null
      const isArchived = ('archived' in raw || 'isArchived' in raw) ? (raw.archived === true || raw.isArchived === true) : false

      let type = 'GROUP'
      let communityId: number | null = null

      const commInfo = parseCommunityMetadata(jid, raw)
      if (commInfo.hasCommunityData) {
        type = commInfo.type
        const rootJidVal = commInfo.rootJid
        if (rootJidVal) {
          communityId = communityJidToIdMap.get(rootJidVal) ?? null
        }
      }

      const existing = existingChatsMap.get(cleanedJid)

      if (existing) {
        // Only overwrite fields that the payload actually provides
        const updateObj: Record<string, any> = { type, isArchived, communityId }
        if (chatName) updateObj.name = chatName  // never blank out an existing name
        if (timestamp !== null) updateObj.timestamp = timestamp  // never zero out an existing timestamp
        if (typeof raw.unreadCount === 'number') updateObj.unreadCount = raw.unreadCount
        if (typeof raw.pinned === 'number') updateObj.pinned = raw.pinned
        if (raw.muteExpiration !== undefined) {
          const mute = raw.muteExpiration
          updateObj.muteExpiration = typeof mute === 'bigint' ? mute : BigInt(typeof mute === 'number' ? mute : 0)
        }
        if (raw.profilePictureUrl !== undefined) updateObj.profilePictureUrl = raw.profilePictureUrl || null
        chatsToUpdate.push({ jid: cleanedJid, ...updateObj })
      } else {
        chatsToInsert.push({
          jid: cleanedJid,
          type,
          unreadCount: typeof raw.unreadCount === 'number' ? raw.unreadCount : 0,
          timestamp: timestamp ?? BigInt(0),
          pinned: typeof raw.pinned === 'number' ? raw.pinned : 0,
          muteExpiration: typeof raw.muteExpiration === 'bigint' ? raw.muteExpiration : BigInt(typeof raw.muteExpiration === 'number' ? raw.muteExpiration : 0),
          isArchived,
          name: chatName,
          communityId,
          profilePictureUrl: raw.profilePictureUrl || null
        })
      }
    }

    if (chatsToInsert.length > 0) {
      await this.prisma.chat.createMany({
        data: chatsToInsert
      })
    }
    if (chatsToUpdate.length > 0) {
      const updateOps = chatsToUpdate.map(c => this.prisma.chat.update({
        where: { jid: c.jid },
        data: c
      }))
      await this.prisma.$transaction(updateOps)
    }

    // --- PHASE 3: Participants ---
    const metadataLinks: { lid: string; pn: string; source: string }[] = []
    for (const jid of groupKeys) {
      const raw = groups[jid]
      if (raw.owner && raw.ownerPn) {
        const cleanOwner = cleanJid(raw.owner)
        const cleanOwnerPn = cleanJid(raw.ownerPn)
        if (cleanOwner.includes('@lid') && cleanOwnerPn.includes('@s.whatsapp.net')) {
          metadataLinks.push({ lid: cleanOwner, pn: cleanOwnerPn, source: 'group.metadata.owner' })
        }
      }
      if (raw.descOwner && raw.descOwnerPn) {
        const cleanDescOwner = cleanJid(raw.descOwner)
        const cleanDescOwnerPn = cleanJid(raw.descOwnerPn)
        if (cleanDescOwner.includes('@lid') && cleanDescOwnerPn.includes('@s.whatsapp.net')) {
          metadataLinks.push({ lid: cleanDescOwner, pn: cleanDescOwnerPn, source: 'group.metadata.descOwner' })
        }
      }
    }

    const parsedParticipants: {
      chatJid: string
      id: string
      lid: string | null
      pn: string | null
      role: 'SUPERADMIN' | 'ADMIN' | 'MEMBER'
    }[] = []

    for (const jid of groupKeys) {
      const raw = groups[jid]
      const cleanedChatJid = cleanJid(jid)
      if (raw.participants && Array.isArray(raw.participants)) {
        for (const p of raw.participants) {
          if (!p.id) continue
          const rawId = cleanJid(p.id)
          const lid = rawId.endsWith('@lid') ? rawId : (p.lid ? cleanJid(p.lid) : null)
          const pn = p.phoneNumber ? cleanJid(p.phoneNumber) : null
          const role = p.admin === 'superadmin' ? 'SUPERADMIN' : (p.admin === 'admin' ? 'ADMIN' : 'MEMBER')
          parsedParticipants.push({
            chatJid: cleanedChatJid,
            id: rawId,
            lid,
            pn,
            role
          })
        }
      }
    }

    if (parsedParticipants.length === 0) return

    const allLids = Array.from(new Set(parsedParticipants.map(p => p.lid).filter((x): x is string => !!x)))
    const allPns = Array.from(new Set(parsedParticipants.map(p => p.pn).filter((x): x is string => !!x)))
    const allIds = Array.from(new Set(parsedParticipants.map(p => p.id)))

    const allJids = Array.from(new Set([...allLids, ...allPns, ...allIds]))

    const aliases = await this.prisma.identityAlias.findMany({
      where: { jid: { in: allJids } }
    })
    const aliasMap = new Map<string, number>()
    for (const a of aliases) {
      aliasMap.set(a.jid, a.identityId)
    }

    const identityIds = Array.from(new Set(aliases.map(a => a.identityId)))
    const phoneNumbersToQuery = allPns.filter(pn => !aliasMap.has(pn))
    
    const identities = await this.prisma.identity.findMany({
      where: {
        OR: [
          { id: { in: identityIds } },
          { phoneNumber: { in: phoneNumbersToQuery } }
        ]
      }
    })

    const identityMap = new Map<number, any>()
    const pnToIdentityIdMap = new Map<string, number>()
    for (const iden of identities) {
      identityMap.set(iden.id, iden)
      if (iden.phoneNumber) {
        pnToIdentityIdMap.set(iden.phoneNumber, iden.id)
      }
    }

    const queryLids = Array.from(new Set([...allLids, ...metadataLinks.map(l => l.lid)]))
    const lidMaps = await this.prisma.lidMap.findMany({
      where: { lid: { in: queryLids } }
    })
    const existingLidMap = new Map<string, string>()
    for (const lm of lidMaps) {
      existingLidMap.set(lm.lid, lm.pn)
    }

    const pnsToCreate = new Set<string>()
    const lidsToCreateIndividual = new Set<string>()
    const lidMapUpserts = new Map<string, { pn: string; source: string }>()
    const aliasesToCreate: { jid: string; type: string; identityId: number }[] = []
    const aliasesToUpdate: { jid: string; identityId: number }[] = []
    const identityPnUpdates = new Map<number, string>()

    for (const link of metadataLinks) {
      if (existingLidMap.get(link.lid) !== link.pn) {
        lidMapUpserts.set(link.lid, { pn: link.pn, source: link.source })
      }
    }

    for (const p of parsedParticipants) {
      if (p.lid && p.pn) {
        if (existingLidMap.get(p.lid) !== p.pn) {
          lidMapUpserts.set(p.lid, { pn: p.pn, source: 'group.participant' })
        }
      }

      let identityId = p.pn ? (aliasMap.get(p.pn) ?? pnToIdentityIdMap.get(p.pn)) : null
      if (!identityId && p.lid) {
        identityId = aliasMap.get(p.lid) ?? null
      }
      if (!identityId) {
        identityId = aliasMap.get(p.id) ?? null
      }

      if (!identityId) {
        let canonicalPn = p.pn
        if (!canonicalPn && p.id.endsWith('@s.whatsapp.net')) {
          canonicalPn = p.id
        }
        if (!canonicalPn && p.lid) {
          canonicalPn = lidMapUpserts.get(p.lid)?.pn ?? existingLidMap.get(p.lid) ?? null
        }

        if (canonicalPn) {
          pnsToCreate.add(canonicalPn)
        } else {
          const stubId = p.lid ?? p.id
          lidsToCreateIndividual.add(stubId)
        }
      }
    }

    if (pnsToCreate.size > 0) {
      await this.prisma.identity.createMany({
        data: Array.from(pnsToCreate).map(pn => ({ phoneNumber: pn }))
      })
      const newIdentities = await this.prisma.identity.findMany({
        where: { phoneNumber: { in: Array.from(pnsToCreate) } },
        select: { id: true, phoneNumber: true }
      })
      for (const iden of newIdentities) {
        if (iden.phoneNumber) {
          pnToIdentityIdMap.set(iden.phoneNumber, iden.id)
          aliasMap.set(iden.phoneNumber, iden.id)
        }
      }
    }

    for (const lid of lidsToCreateIndividual) {
      const newIden = await this.prisma.identity.create({
        data: { phoneNumber: null }
      })
      aliasMap.set(lid, newIden.id)
    }

    const warmedCacheEntries = new Map<string, number>()

    for (const p of parsedParticipants) {
      const cleanLid = p.lid
      const cleanPn = p.pn

      if (cleanLid && cleanPn) {
        const cacheKey = `${cleanLid}->${cleanPn}`
        this.contactService.warmLinkCache(cacheKey)

        const lidIdentityId = aliasMap.get(cleanLid)
        const pnIdentityId = aliasMap.get(cleanPn) ?? pnToIdentityIdMap.get(cleanPn)

        if (pnIdentityId) {
          if (lidIdentityId && lidIdentityId !== pnIdentityId) {
            aliasesToUpdate.push({ jid: cleanLid, identityId: pnIdentityId })
            aliasMap.set(cleanLid, pnIdentityId)
          } else if (!lidIdentityId) {
            aliasesToCreate.push({ jid: cleanLid, type: 'LID', identityId: pnIdentityId })
            aliasMap.set(cleanLid, pnIdentityId)
          }
        } else if (lidIdentityId) {
          identityPnUpdates.set(lidIdentityId, cleanPn)
          pnToIdentityIdMap.set(cleanPn, lidIdentityId)
          aliasesToCreate.push({ jid: cleanPn, type: 'PN', identityId: lidIdentityId })
          aliasMap.set(cleanPn, lidIdentityId)
        }
      }

      let identityId = p.pn ? (aliasMap.get(p.pn) ?? pnToIdentityIdMap.get(p.pn)) : null
      if (!identityId && p.lid) {
        identityId = aliasMap.get(p.lid) ?? null
      }
      if (!identityId) {
        identityId = aliasMap.get(p.id) ?? null
      }

      if (identityId) {
        const jidsToCheck = [p.id]
        if (p.pn) jidsToCheck.push(p.pn)
        if (p.lid) jidsToCheck.push(p.lid)

        for (const jid of jidsToCheck) {
          if (aliasMap.get(jid) !== identityId) {
            if (aliasMap.has(jid)) {
              aliasesToUpdate.push({ jid, identityId })
            } else {
              const type = jid.endsWith('@s.whatsapp.net') ? 'PN' : (jid.endsWith('@lid') ? 'LID' : 'PN')
              aliasesToCreate.push({ jid, type, identityId })
            }
            aliasMap.set(jid, identityId)
          }
          warmedCacheEntries.set(jid, identityId)
        }
      }
    }

    if (identityPnUpdates.size > 0) {
      const updates = Array.from(identityPnUpdates.entries()).map(([id, pn]) =>
        this.prisma.identity.update({
          where: { id },
          data: { phoneNumber: pn }
        })
      )
      await this.prisma.$transaction(updates)
    }

    if (aliasesToCreate.length > 0) {
      const uniqueAliasesMap = new Map<string, { jid: string; type: string; identityId: number }>()
      for (const a of aliasesToCreate) {
        uniqueAliasesMap.set(a.jid, a)
      }
      await this.prisma.identityAlias.createMany({
        data: Array.from(uniqueAliasesMap.values())
      })
    }
    if (aliasesToUpdate.length > 0) {
      const updates = aliasesToUpdate.map(a =>
        this.prisma.identityAlias.update({
          where: { jid: a.jid },
          data: { identityId: a.identityId }
        })
      )
      await this.prisma.$transaction(updates)
    }

    if (lidMapUpserts.size > 0) {
      const updatesList = Array.from(lidMapUpserts.entries()).map(([lid, x]) => ({ lid, pn: x.pn, source: x.source }))
      const lidMapsToUpdate = updatesList.filter(x => existingLidMap.has(x.lid))
      const lidMapsToInsert = updatesList.filter(x => !existingLidMap.has(x.lid))

      if (lidMapsToInsert.length > 0) {
        await this.prisma.lidMap.createMany({
          data: lidMapsToInsert.map(x => ({
            lid: x.lid,
            pn: x.pn,
            source: x.source,
            lastSeenDateTime: BigInt(Math.floor(Date.now() / 1000))
          }))
        })
      }
      if (lidMapsToUpdate.length > 0) {
        const updates = lidMapsToUpdate.map(x =>
          this.prisma.lidMap.update({
            where: { lid: x.lid },
            data: { pn: x.pn, source: x.source, lastSeenDateTime: BigInt(Math.floor(Date.now() / 1000)) }
          })
        )
        await this.prisma.$transaction(updates)
      }
    }

    // --- PHASE 4: ChatMember ---
    const existingMembers = await this.prisma.chatMember.findMany({
      where: { chatJid: { in: allGroupJids } }
    })
    const existingMemberRoles = new Map(existingMembers.map(m => [`${m.chatJid}_${m.identityId}`, m.role]))

    const membersToInsert: { chatJid: string; identityId: number; role: string }[] = []
    const membersToUpdate: { chatJid: string; identityId: number; role: string }[] = []

    for (const p of parsedParticipants) {
      let identityId = p.pn ? (aliasMap.get(p.pn) ?? pnToIdentityIdMap.get(p.pn)) : null
      if (!identityId && p.lid) {
        identityId = aliasMap.get(p.lid) ?? null
      }
      if (!identityId) {
        identityId = aliasMap.get(p.id) ?? null
      }

      if (identityId) {
        const key = `${p.chatJid}_${identityId}`
        if (!existingMemberRoles.has(key)) {
          membersToInsert.push({ chatJid: p.chatJid, identityId, role: p.role })
          existingMemberRoles.set(key, p.role)
        } else if (existingMemberRoles.get(key) !== p.role) {
          membersToUpdate.push({ chatJid: p.chatJid, identityId, role: p.role })
          existingMemberRoles.set(key, p.role)
        }
      }
    }

    if (membersToInsert.length > 0) {
      await this.prisma.chatMember.createMany({
        data: membersToInsert
      })
    }
    if (membersToUpdate.length > 0) {
      const updates = membersToUpdate.map(m =>
        this.prisma.chatMember.update({
          where: { chatJid_identityId: { chatJid: m.chatJid, identityId: m.identityId } },
          data: { role: m.role }
        })
      )
      await this.prisma.$transaction(updates)
    }

    this.contactService.populateIdentityIdCache(warmedCacheEntries)
  }
}
