import { IGroupMembershipService } from './IGroupMembershipService'
import { IContactService } from '../contacts/IContactService'
import { IChatMemberRepository } from './IChatMemberRepository'
import { cleanJid } from '../../utils'
import { ChatUpdatePayload } from '../whatsapp/types'

export class GroupMembershipService implements IGroupMembershipService {
  constructor(
    private readonly chatMemberRepository: IChatMemberRepository,
    private readonly contactService: IContactService
  ) {}

  /**
   * Syncs group participants into the ChatMember table.
   */
  async syncGroupMembers(
    chatJid: string,
    participants: Array<{
      id: string
      admin?: 'admin' | 'superadmin' | null
      lid?: string | null
      phoneNumber?: string | null
    }>
  ): Promise<void> {
    const cleanedChatJid = cleanJid(chatJid)
    
    // Pre-parse and normalize participant JIDs
    const parsedParticipants = participants
      .map(p => {
        if (!p.id) return null
        const rawId = cleanJid(p.id)
        const lid = rawId.endsWith('@lid') ? rawId : (p.lid ? cleanJid(p.lid) : null)
        const pn = p.phoneNumber ? cleanJid(p.phoneNumber) : null
        return {
          id: rawId,
          lid,
          pn,
          admin: p.admin
        }
      })
      .filter((p): p is NonNullable<typeof p> => p !== null)

    if (parsedParticipants.length === 0) return

    // Batched pre-fetch of all identity IDs for clean JIDs
    const allQueryJids: string[] = []
    for (const p of parsedParticipants) {
      if (p.pn) allQueryJids.push(p.pn)
      if (p.lid) allQueryJids.push(p.lid)
      allQueryJids.push(p.id)
    }
    await this.contactService.batchGetIdentityIds(allQueryJids)

    let count = 0
    for (const p of parsedParticipants) {
      if (++count % 5 === 0) {
        await new Promise(r => setImmediate(r))
      }

      // 1. If we have both LID and phone number, link them.
      if (p.lid && p.pn) {
        await this.contactService.linkLidAndPn(p.lid, p.pn, 'group.participant').catch((err) => {
          console.error('[GroupMembershipService] Failed to link group participant LID and PN:', err)
        })
      }

      // 2. Look up identity (pre-fetched or cached)
      let identityId = p.pn
        ? await this.contactService.getIdentityIdByJid(p.pn)
        : null
      if (!identityId && p.lid) {
        identityId = await this.contactService.getIdentityIdByJid(p.lid)
      }
      if (!identityId) {
        identityId = await this.contactService.getIdentityIdByJid(p.id)
      }

      // 3. Still not found — create a minimal contact
      if (!identityId) {
        const contactId = p.pn ?? p.lid ?? p.id
        await this.contactService.upsertContact({ id: contactId, ...(p.lid && p.pn ? { lid: p.lid } : {}) }).catch((err) => {
          console.error('[GroupMembershipService] Failed to upsert group participant contact:', err)
        })
        identityId = p.pn
          ? await this.contactService.getIdentityIdByJid(p.pn)
          : await this.contactService.getIdentityIdByJid(p.id)
      }

      if (identityId) {
        const role = p.admin === 'superadmin' ? 'SUPERADMIN' : (p.admin === 'admin' ? 'ADMIN' : 'MEMBER')
        await this.chatMemberRepository.upsertChatMember(cleanedChatJid, identityId, role).catch((err) => {
          console.error('[GroupMembershipService] Failed to upsert chat member:', err)
        })
      }
    }
  }

  /**
   * Links group metadata owners (owner and descOwner LIDs to PNs) if present.
   */
  async linkGroupMetadataOwners(update: ChatUpdatePayload): Promise<void> {
    if (update.owner && update.ownerPn) {
      const cleanOwner = cleanJid(update.owner)
      const cleanOwnerPn = cleanJid(update.ownerPn)
      if (cleanOwner.includes('@lid') && cleanOwnerPn.includes('@s.whatsapp.net')) {
        await this.contactService.linkLidAndPn(cleanOwner, cleanOwnerPn, 'group.metadata.owner').catch((err) => {
          console.error('[GroupMembershipService] Failed to link owner LID and PN:', err)
        })
      }
    }
    if (update.descOwner && update.descOwnerPn) {
      const cleanDescOwner = cleanJid(update.descOwner)
      const cleanDescOwnerPn = cleanJid(update.descOwnerPn)
      if (cleanDescOwner.includes('@lid') && cleanDescOwnerPn.includes('@s.whatsapp.net')) {
        await this.contactService.linkLidAndPn(cleanDescOwner, cleanDescOwnerPn, 'group.metadata.descOwner').catch((err) => {
          console.error('[GroupMembershipService] Failed to link descOwner LID and PN:', err)
        })
      }
    }
  }
}
