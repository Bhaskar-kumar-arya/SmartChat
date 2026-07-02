import { IContactQueryService } from './IContactService'
import { IProfileSyncService, IProfileSyncSocket } from './IProfileSyncService'
import { IIdentityRepository } from './IIdentityRepository'
import { IChatRepository } from '../chats/IChatRepository'

export class ProfileSyncService implements IProfileSyncService {
  private imageCache = new Map<string, string>()

  constructor(
    private identityRepository: IIdentityRepository,
    private chatRepository: IChatRepository,
    private contactService: IContactQueryService
  ) {}

  /**
   * Fetches the profile picture URL.
   */
  async getProfilePicture(
    jid: string,
    type: 'preview' | 'image' = 'preview',
    sock?: IProfileSyncSocket | null,
    forceRefresh: boolean = false
  ): Promise<string | null> {
    // Helper to resolve LID to Phone Number JID
    let targetJid = jid
    let resolvedIdentityId: number | null = null

    if (!jid.endsWith('@g.us') && sock) {
      resolvedIdentityId = await this.contactService.getIdentityIdByJid(jid)
      if (resolvedIdentityId) {
        const ident = await this.identityRepository.findIdentityById(resolvedIdentityId)
        if (ident?.phoneNumber) {
          targetJid = ident.phoneNumber
        }
      }
    }

    if (type === 'image') {
      if (!forceRefresh && this.imageCache.has(jid)) return this.imageCache.get(jid)!
      if (!sock) return null

      try {
        if (!sock.profilePictureUrl) return null
        const url = await sock.profilePictureUrl(targetJid, 'image')
        if (url) this.imageCache.set(jid, url)
        return url || null
      } catch (e) {
        const errorVal = e as any
        const errorMessage = errorVal?.message || String(errorVal)
        const isExpectedPPError =
          errorMessage.includes('item-not-found') || errorMessage.includes('not-authorized')

        if (!isExpectedPPError) {
          console.warn(`[ProfileSyncService] Failed to fetch full profile picture for ${targetJid} (original: ${jid}):`, e)
        }
        return null
      }
    }

    if (!forceRefresh) {
      // Check Chat first (groups)
      if (jid.endsWith('@g.us')) {
        const chat = await this.chatRepository.findChatByJid(jid)
        if (chat?.profilePictureUrl) return chat.profilePictureUrl
      } else {
        // Check Identity (contacts)
        const identityId = await this.contactService.getIdentityIdByJid(jid)
        if (identityId) {
          const ident = await this.identityRepository.findIdentityById(identityId)
          if (ident?.profilePictureUrl) return ident.profilePictureUrl
        }
      }
    }

    if (!sock) return null

    try {
      if (!sock.profilePictureUrl) return null
      const url = await sock.profilePictureUrl(targetJid, 'preview')
      if (url) {
        if (jid.endsWith('@g.us')) {
          await this.chatRepository.upsertChat(jid, { profilePictureUrl: url }).catch((err) => {
            console.error('[ProfileSyncService] Failed to update chat profilePictureUrl:', err)
          })
        } else {
          const identityId = await this.contactService.getIdentityIdByJid(jid)
          if (identityId) {
            await this.identityRepository.updateIdentity(identityId, { profilePictureUrl: url }).catch((err) => {
              console.error('[ProfileSyncService] Failed to update identity profilePictureUrl:', err)
            })
          }
        }
      }
      return url || null
    } catch (e) {
      // console.warn(`[ProfileSyncService] Failed to fetch preview profile picture for ${jid}:`, e)
      return null
    }
  }
}
