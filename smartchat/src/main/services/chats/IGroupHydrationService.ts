import { BaileysGroupMetadata } from './types'

export interface IGroupHydrationService {
  hydrateGroups(
    groups: Record<string, BaileysGroupMetadata>,
    onProgress?: (progress: number, status: string) => void
  ): Promise<void>
}
