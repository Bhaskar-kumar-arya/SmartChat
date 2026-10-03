import { IGroupMembershipService } from './IGroupMembershipService'
import { IContactMutationService, IContactQueryService } from '../contacts/IContactService'
import { IMembershipSyncHandler } from './sync/IMembershipSyncHandler'
import { IChatMemberRepository } from './IChatMemberRepository'
import { cleanJid } from '../../utils/jidUtils'
import { ChatUpdatePayload } from '../whatsapp/types'

export class GroupMembershipService implements IGroupMembershipService {
  constructor(
    private readonly chatMemberRepository: IChatMemberRepository,
    private readonly contactService: IContactMutationService & IContactQueryService,
    private readonly membershipSyncHandler: IMembershipSyncHandler
  ) {}

  /**
   * Syncs live participants into ChatMember through the same batched, deduped path as full-sync
   * hydration. Live lists are deltas, so absent members are never pruned.
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
    const usable = participants.filter((p) => !!p.id)
    if (usable.length === 0) return

    // The batched writer inserts ChatMember rows directly, so the FK parent must exist.
    if (!(await this.chatMemberRepository.ensureChat(cleanedChatJid))) {
      console.error(`[GroupMembershipService] cannot create/find chat ${cleanedChatJid}; skipping member sync`)
      return
    }

    await this.membershipSyncHandler.syncMemberships(
      { [cleanedChatJid]: { id: cleanedChatJid, participants: usable } },
      { prune: false }
    )
  }

  async applyParticipantRoleChange(
    chatJid: string,
    jids: string[],
    action: 'add' | 'promote' | 'demote'
  ): Promise<void> {
    const admin = action === 'promote' ? 'admin' : null
    await this.syncGroupMembers(
      chatJid,
      jids.map((id) => ({ id, admin }))
    )
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
