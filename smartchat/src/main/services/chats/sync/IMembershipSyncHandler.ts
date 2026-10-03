import { BaileysGroupMetadata } from '../../whatsapp/types/group.types'

export interface IMembershipSyncHandler {
  /**
   * `prune` (default true): treat each group's participant list as authoritative and delete members
   * not in it. Live delta updates pass `prune: false`.
   */
  syncMemberships(groups: Record<string, BaileysGroupMetadata>, options?: { prune?: boolean }): Promise<void>
}
