import { ChatUpdatePayload } from '../whatsapp/types'

export interface IGroupMembershipService {
  syncGroupMembers(
    chatJid: string,
    participants: Array<{
      id: string
      admin?: 'admin' | 'superadmin' | null
      lid?: string | null
      phoneNumber?: string | null
    }>
  ): Promise<void>

  /**
   * Live add/promote/demote through the batched resolver (no pruning). `remove` is not handled here.
   */
  applyParticipantRoleChange(chatJid: string, jids: string[], action: 'add' | 'promote' | 'demote'): Promise<void>

  linkGroupMetadataOwners(update: ChatUpdatePayload): Promise<void>
}
