import { BaileysGroupMetadata } from '../../whatsapp/types/group.types'

export interface IChatSyncHandler {
  syncChats(
    groups: Record<string, BaileysGroupMetadata>,
    communityJidToIdMap: Map<string, number>
  ): Promise<void>
}
