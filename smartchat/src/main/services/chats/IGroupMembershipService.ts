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

  linkGroupMetadataOwners(update: ChatUpdatePayload): Promise<void>
}
