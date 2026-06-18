import { SyncRepository, SyncChatMemberUpsert } from '../../sync/SyncRepository'
import { ContactService } from '../../contacts/ContactService'
import { BaileysGroupMetadata } from '../GroupHydrationService'
import { cleanJid } from '../../../utils'

export class MembershipSyncHandler {
  constructor(
    private readonly syncRepository: SyncRepository,
    private readonly contactService: ContactService
  ) {}

  /**
   * Synchronizes memberships and links/identities for a batch of groups.
   */
  async syncMemberships(groups: Record<string, BaileysGroupMetadata>): Promise<void> {
    const groupKeys = Object.keys(groups)
    if (groupKeys.length === 0) return

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

    const aliases = await this.syncRepository.findIdentityAliases(allJids)
    const aliasMap = new Map<string, number>()
    for (const a of aliases) {
      aliasMap.set(a.jid, a.identityId)
    }

    const identityIds = Array.from(new Set(aliases.map(a => a.identityId)))
    const phoneNumbersToQuery = allPns.filter(pn => !aliasMap.has(pn))
    
    const identities = await this.syncRepository.findIdentities(identityIds, phoneNumbersToQuery)

    const identityMap = new Map<number, typeof identities[number]>()
    const pnToIdentityIdMap = new Map<string, number>()
    for (const iden of identities) {
      identityMap.set(iden.id, iden)
      if (iden.phoneNumber) {
        pnToIdentityIdMap.set(iden.phoneNumber, iden.id)
      }
    }

    const queryLids = Array.from(new Set([...allLids, ...metadataLinks.map(l => l.lid)]))
    const lidMaps = await this.syncRepository.findLidMaps(queryLids)
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
      await this.syncRepository.bulkCreateIdentities(Array.from(pnsToCreate))
      const newIdentities = await this.syncRepository.findIdentitiesByPhoneNumbers(Array.from(pnsToCreate))
      for (const iden of newIdentities) {
        if (iden.phoneNumber) {
          pnToIdentityIdMap.set(iden.phoneNumber, iden.id)
          aliasMap.set(iden.phoneNumber, iden.id)
        }
      }
    }

    for (const lid of lidsToCreateIndividual) {
      const newIden = await this.syncRepository.createIdentity(null)
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
      const updates = Array.from(identityPnUpdates.entries()).map(([id, pn]) => ({ id, phoneNumber: pn }))
      await this.syncRepository.bulkUpdateIdentities(updates)
    }

    if (aliasesToCreate.length > 0) {
      const uniqueAliasesMap = new Map<string, { jid: string; type: string; identityId: number }>()
      for (const a of aliasesToCreate) {
        uniqueAliasesMap.set(a.jid, a)
      }
      await this.syncRepository.bulkCreateIdentityAliases(Array.from(uniqueAliasesMap.values()))
    }
    if (aliasesToUpdate.length > 0) {
      await this.syncRepository.bulkUpdateIdentityAliases(aliasesToUpdate)
    }

    if (lidMapUpserts.size > 0) {
      const entries = Array.from(lidMapUpserts.entries()).map(([lid, x]) => ({ lid, pn: x.pn, source: x.source }))
      const existingLidsSet = new Set(lidMaps.map(lm => lm.lid))
      await this.syncRepository.bulkUpsertLidMaps(entries, existingLidsSet)
    }

    // --- PHASE 4: ChatMember ---
    const allGroupJids = groupKeys.map(cleanJid).filter(Boolean)
    const existingMembers = await this.syncRepository.findExistingMemberRoles(allGroupJids)
    const existingMemberRoles = new Map(existingMembers.map(m => [`${m.chatJid}_${m.identityId}`, m.role]))

    const membersToUpsert: SyncChatMemberUpsert[] = []

    for (const p of parsedParticipants) {
      let identityId = p.pn ? (aliasMap.get(p.pn) ?? pnToIdentityIdMap.get(p.pn)) : null
      if (!identityId && p.lid) {
        identityId = aliasMap.get(p.lid) ?? null
      }
      if (!identityId) {
        identityId = aliasMap.get(p.id) ?? null
      }

      if (identityId) {
        membersToUpsert.push({ chatJid: p.chatJid, identityId, role: p.role })
      }
    }

    await this.syncRepository.bulkUpsertChatMembers(membersToUpsert, existingMemberRoles)

    this.contactService.populateIdentityIdCache(warmedCacheEntries)
  }
}
