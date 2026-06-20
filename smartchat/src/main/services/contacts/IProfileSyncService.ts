import { WASocket } from '../whatsapp/types'

export interface IProfileSyncService {
  getProfilePicture(
    jid: string,
    type?: 'preview' | 'image',
    sock?: WASocket | null,
    forceRefresh?: boolean
  ): Promise<string | null>
}
