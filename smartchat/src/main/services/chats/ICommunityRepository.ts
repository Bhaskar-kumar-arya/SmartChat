import { Community } from '@prisma/client'

export interface ICommunityRepository {
  upsertCommunity(jid: string, name: string | null): Promise<Community>
  updateCommunityAnnounceJid(id: number, announceJid: string): Promise<Community>
}
