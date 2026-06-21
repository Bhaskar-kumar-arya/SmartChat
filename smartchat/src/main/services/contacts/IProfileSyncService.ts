export interface IProfileSyncSocket {
  profilePictureUrl?: (jid: string, type: 'preview' | 'image') => Promise<string | undefined>
}

export interface IProfileSyncService {
  getProfilePicture(
    jid: string,
    type?: 'preview' | 'image',
    sock?: IProfileSyncSocket | null,
    forceRefresh?: boolean
  ): Promise<string | null>
}
