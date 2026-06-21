import { BaileysGroupMetadata } from '../../whatsapp/types/group.types'

export interface IMembershipSyncHandler {
  syncMemberships(groups: Record<string, BaileysGroupMetadata>): Promise<void>
}
