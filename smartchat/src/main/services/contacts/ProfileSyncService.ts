import { PrismaClient } from '@prisma/client'
import { IContactService } from './IContactService'
import { WASocket } from '../whatsapp/types'
import { IProfileSyncService } from './IProfileSyncService'

export class ProfileSyncService implements IProfileSyncService {
  private imageCache = new Map<string, string>()

  constructor(
    private prisma: PrismaClient,
    private contactService: IContactService
  ) {}

  /**
   * Fetches the profile picture URL.
   */
  async getProfilePicture(
    jid: string,
    type: 'preview' | 'image' = 'preview',
    sock?: WASocket | null,
    forceRefresh: boolean = false
  ): Promise<string | null> {
    if (type === 'image') {
      if (!forceRefresh && this.imageCache.has(jid)) return this.imageCache.get(jid)!
      if (!sock) return null

      try {
        const url = await sock.profilePictureUrl(jid, 'image')
        if (url) this.imageCache.set(jid, url)
        return url || null
      } catch (e) {
        console.warn(`[ProfileSyncService] Failed to fetch full profile picture for ${jid}:`, e)
        return null
      }
    }

    if (!forceRefresh) {
      // Check Chat first (groups)
      if (jid.endsWith('@g.us')) {
        const chat = await this.prisma.chat.findUnique({ where: { jid }, select: { profilePictureUrl: true } })
        if (chat?.profilePictureUrl) return chat.profilePictureUrl
      } else {
        // Check Identity (contacts)
        const identityId = await this.contactService.getIdentityIdByJid(jid)
        if (identityId) {
          const ident = await this.prisma.identity.findUnique({ where: { id: identityId }, select: { profilePictureUrl: true } })
          if (ident?.profilePictureUrl) return ident.profilePictureUrl
        }
      }
    }

    if (!sock) return null

    try {
      const url = await sock.profilePictureUrl(jid, 'preview')
      if (url) {
        if (jid.endsWith('@g.us')) {
          await this.prisma.chat.update({
            where: { jid },
            data: { profilePictureUrl: url }
          }).catch((err) => {
            console.error('[ProfileSyncService] Failed to update chat profilePictureUrl:', err)
          })
        } else {
          const identityId = await this.contactService.getIdentityIdByJid(jid)
          if (identityId) {
            await this.prisma.identity.update({
              where: { id: identityId },
              data: { profilePictureUrl: url }
            }).catch((err) => {
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
