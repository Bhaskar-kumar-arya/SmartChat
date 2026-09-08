import { IContactQueryService } from './IContactService'
import { IProfileSyncService, IProfileSyncSocket } from './IProfileSyncService'
import { IIdentityRepository } from './IIdentityRepository'
import { IChatRepository } from '../chats/IChatRepository'

const MAX_IMAGE_CACHE = 500
const NEGATIVE_TTL_MS = 10 * 60 * 1000

/**
 * P2-S5-05: WhatsApp profile-picture URLs are time-limited CDN URLs carrying an
 * `oe` (expiry) query param — a hex unix timestamp (seconds). Once past that the
 * URL 404s and the avatar renders broken. Treat a stored URL as unusable on the
 * cached read path once its `oe` has elapsed so the next fetch refreshes it.
 */
export function isProfilePictureUrlExpired(url: string | null | undefined): boolean {
  if (!url) return false
  const match = /[?&]oe=([0-9a-fA-F]+)/.exec(url)
  if (!match) return false
  const expirySec = parseInt(match[1], 16)
  if (!Number.isFinite(expirySec) || expirySec <= 0) return false
  return expirySec * 1000 <= Date.now()
}

export class ProfileSyncService implements IProfileSyncService {
  // P2-S5-04: bounded (FIFO) so a long-lived process can't leak one entry per
  // viewed full image.
  private imageCache = new Map<string, string>()
  // P2-S5-04: negatively cache "no picture" / transient failures with a short
  // TTL so a contact without an avatar doesn't cause a network round-trip on
  // every single chat-list / header render.
  private negativeCache = new Map<string, number>()

  constructor(
    private identityRepository: IIdentityRepository,
    private chatRepository: IChatRepository,
    private contactService: IContactQueryService
  ) {}

  public clearCache(): void {
    this.imageCache.clear()
    this.negativeCache.clear()
  }

  private setImageCache(jid: string, url: string): void {
    this.imageCache.delete(jid)
    this.imageCache.set(jid, url)
    if (this.imageCache.size > MAX_IMAGE_CACHE) {
      const oldest = this.imageCache.keys().next().value
      if (oldest !== undefined) this.imageCache.delete(oldest)
    }
  }

  private isNegativelyCached(key: string): boolean {
    const expiry = this.negativeCache.get(key)
    if (expiry === undefined) return false
    if (expiry <= Date.now()) {
      this.negativeCache.delete(key)
      return false
    }
    return true
  }

  private markNegative(key: string): void {
    this.negativeCache.set(key, Date.now() + NEGATIVE_TTL_MS)
  }

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
    const isGroup = jid.endsWith('@g.us')

    if (!isGroup && sock) {
      resolvedIdentityId = await this.contactService.getIdentityIdByJid(jid)
      if (resolvedIdentityId) {
        const ident = await this.identityRepository.findIdentityById(resolvedIdentityId)
        if (ident?.phoneNumber) {
          targetJid = ident.phoneNumber
        }
      }
    }

    const negKey = `${type}:${jid}`

    if (type === 'image') {
      if (!forceRefresh && this.imageCache.has(jid)) return this.imageCache.get(jid)!
      if (!forceRefresh && this.isNegativelyCached(negKey)) return null
      if (!sock) return null

      try {
        if (!sock.profilePictureUrl) return null
        const url = await sock.profilePictureUrl(targetJid, 'image')
        if (url) {
          this.setImageCache(jid, url)
          return url
        }
        this.markNegative(negKey)
        return null
      } catch (e) {
        const errorVal = e as any
        const errorMessage = errorVal?.message || String(errorVal)
        const isExpectedPPError =
          errorMessage.includes('item-not-found') || errorMessage.includes('not-authorized')

        if (!isExpectedPPError) {
          console.warn(`[ProfileSyncService] Failed to fetch full profile picture for ${targetJid} (original: ${jid}):`, e)
        }
        this.markNegative(negKey)
        return null
      }
    }

    if (!forceRefresh) {
      // Check Chat first (groups)
      if (isGroup) {
        const chat = await this.chatRepository.findChatByJid(jid)
        if (chat?.profilePictureUrl && !isProfilePictureUrlExpired(chat.profilePictureUrl)) {
          return chat.profilePictureUrl
        }
      } else {
        // Check Identity (contacts) — reuse the id resolved above when available
        const identityId = resolvedIdentityId ?? (await this.contactService.getIdentityIdByJid(jid))
        if (identityId) {
          resolvedIdentityId = identityId
          const ident = await this.identityRepository.findIdentityById(identityId)
          if (ident?.profilePictureUrl && !isProfilePictureUrlExpired(ident.profilePictureUrl)) {
            return ident.profilePictureUrl
          }
        }
      }
      if (this.isNegativelyCached(negKey)) return null
    }

    if (!sock) return null

    try {
      if (!sock.profilePictureUrl) return null
      const url = await sock.profilePictureUrl(targetJid, 'preview')
      if (url) {
        if (isGroup) {
          await this.chatRepository.upsertChat(jid, { profilePictureUrl: url }).catch((err) => {
            console.error('[ProfileSyncService] Failed to update chat profilePictureUrl:', err)
          })
        } else {
          const identityId = resolvedIdentityId ?? (await this.contactService.getIdentityIdByJid(jid))
          if (identityId) {
            await this.identityRepository.updateIdentity(identityId, { profilePictureUrl: url }).catch((err) => {
              console.error('[ProfileSyncService] Failed to update identity profilePictureUrl:', err)
            })
          }
        }
        return url
      }
      this.markNegative(negKey)
      return null
    } catch (e) {
      // console.warn(`[ProfileSyncService] Failed to fetch preview profile picture for ${jid}:`, e)
      this.markNegative(negKey)
      return null
    }
  }
}
