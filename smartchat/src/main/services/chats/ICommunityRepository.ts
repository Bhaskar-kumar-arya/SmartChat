import { Community } from '../../domain/types'

export interface ICommunityWriteRepository {
  upsertCommunity(jid: string, name: string | null): Promise<Community>
  updateCommunityAnnounceJid(id: number, announceJid: string): Promise<Community>
}

export interface ICommunityRepository extends ICommunityWriteRepository {}
