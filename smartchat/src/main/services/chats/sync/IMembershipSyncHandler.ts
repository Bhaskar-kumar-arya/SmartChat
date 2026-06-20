import { BaileysGroupMetadata } from '../types'

export interface IMembershipSyncHandler {
  syncMemberships(groups: Record<string, BaileysGroupMetadata>): Promise<void>
}
