import { BaileysGroupMetadata } from '../../whatsapp/types/group.types'

export interface ICommunitySyncHandler {
  syncCommunities(
    groups: Record<string, BaileysGroupMetadata>
  ): Promise<Map<string, number>>
}
