import { BaileysGroupMetadata } from '../whatsapp/types/group.types'

export interface IGroupHydrationService {
  hydrateGroups(
    groups: Record<string, BaileysGroupMetadata>,
    onProgress?: (progress: number, status: string) => void
  ): Promise<void>
}
