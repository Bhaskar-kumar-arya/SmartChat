import { BaileysGroupMetadata } from '../types'

export interface ICommunitySyncHandler {
  syncCommunities(
    groups: Record<string, BaileysGroupMetadata>
  ): Promise<Map<string, number>>
}
