import { prisma } from '../auth'

export class ContactService {
  /**
   * Resolves a collection of JIDs into a map of display names.
   * Efficiently handles the N+1 problem by batching DB requests.
   */
  async batchResolveNames(
    jids: string[],
    sock?: any
  ): Promise<Map<string, string>> {
    const uniqueJids = Array.from(new Set(jids.filter(Boolean)))
    if (uniqueJids.length === 0) return new Map()

    const BATCH_SIZE = 250
    const aliases: any[] = []
    
    for (let i = 0; i < uniqueJids.length; i += BATCH_SIZE) {
      const chunk = uniqueJids.slice(i, i + BATCH_SIZE)
      const res = await prisma.identityAlias.findMany({
        where: { jid: { in: chunk } },
        include: { identity: true }
      })
      aliases.push(...res)
    }

    const nameMap = new Map<string, string>()

    // Check "Me" first if sock is provided
    let myJid: string | null = null
    let myLid: string | null = null
    if (sock?.user) {
        myJid = sock.user.id.split(':')[0]
        myLid = (sock.user as any).lid?.split(':')[0]
    }

    for (const jid of uniqueJids) {
      // 1. Is it "Me"?
      if (myJid && (jid.includes(myJid) || (myLid && jid.includes(myLid)))) {
        nameMap.set(jid, sock.user.name || 'Me')
        continue
      }

      // 2. Find matching alias
      const alias = aliases.find(a => a.jid === jid || a.jid === jid.split(':')[0])
      
      if (alias && alias.identity) {
        const ident = alias.identity
        const finalName = ident.displayName || ident.verifiedName || ident.pushName || ident.phoneNumber?.split('@')[0] || jid.split('@')[0]
        nameMap.set(jid, finalName)
      } else {
        nameMap.set(jid, jid.split('@')[0])
      }
    }

    return nameMap
  }

  /**
   * Resolves a single JID into a display name.
   */
  async resolveName(jid: string, chatName: string | null, sock?: any): Promise<string> {
    const map = await this.batchResolveNames([jid], sock)
    const resolved = map.get(jid)
    // If it's just the raw number (fallback), and we have a chatName, use the chatName
    if (resolved === jid.split('@')[0] && chatName) {
      return chatName
    }
    return resolved || chatName || jid.split('@')[0]
  }

  /**
   * Handles contacts.upsert and contacts.update logic.
   */
  async upsertContact(contact: any, options: { overwriteName?: boolean } = {}): Promise<void> {
    const id = contact.id
    if (!id) return

    const lid = contact.lid
    const phoneNumber = contact.phoneNumber || (id.endsWith('@s.whatsapp.net') ? id : null)
    const newName = contact.name
    const newNotify = contact.notify ?? contact.pushName
    const newVerifiedName = contact.verifiedName

    // 1. Identify or Create the Canonical Identity
    let identityId: number | null = null

    // Look for existing identity by phone number
    if (phoneNumber) {
      const existingById = await prisma.identity.findUnique({ where: { phoneNumber } })
      if (existingById) identityId = existingById.id
    }

    // Look for existing identity by LID alias if not found by PN
    if (!identityId && (lid || id.endsWith('@lid'))) {
      const searchLid = lid || id
      const existingByAlias = await prisma.identityAlias.findUnique({ where: { jid: searchLid } })
      if (existingByAlias) identityId = existingByAlias.identityId
    }

    // Still not found? Look for existing identity by the JID alias itself
    if (!identityId) {
      const existingByAlias = await prisma.identityAlias.findUnique({ where: { jid: id } })
      if (existingByAlias) identityId = existingByAlias.identityId
    }

    // Create the Identity if it doesn't exist
    if (!identityId) {
      const newIdentity = await prisma.identity.create({
        data: {
          phoneNumber: phoneNumber,
          displayName: newName,
          pushName: newNotify,
          verifiedName: newVerifiedName
        }
      })
      identityId = newIdentity.id
    } else {
      // Update existing identity
      const updateData: any = {}
      if (phoneNumber) updateData.phoneNumber = phoneNumber // Ensure PN is attached if we just discovered it
      if (newNotify !== undefined) updateData.pushName = newNotify
      if (newVerifiedName !== undefined) updateData.verifiedName = newVerifiedName
      if (newName !== undefined && options.overwriteName) {
        updateData.displayName = newName
      }

      if (Object.keys(updateData).length > 0) {
        await prisma.identity.update({
          where: { id: identityId },
          data: updateData
        })
      }
    }

    // 2. Ensure Aliases are created and pointing to the correct identity
    const ensureAlias = async (jid: string, type: string) => {
      await prisma.identityAlias.upsert({
        where: { jid },
        update: { identityId: identityId as number },
        create: { jid, type, identityId: identityId as number }
      })
    }

    if (id.endsWith('@s.whatsapp.net')) {
      await ensureAlias(id, 'PN')
    } else if (id.endsWith('@lid')) {
      await ensureAlias(id, 'LID')
    } else if (id.endsWith('@g.us')) {
      // If a group subject update comes through the contacts pipeline
      await ensureAlias(id, 'GROUP')
    } else if (id.endsWith('@bot')) {
      await ensureAlias(id, 'BOT')
    }

    // If payload contains a LID, ensure that alias is created too
    if (lid) {
      await ensureAlias(lid, 'LID')
    }
  }

  /**
   * Links a LID to a PN explicitly (e.g., from lid-mapping.update events).
   */
  async linkLidAndPn(lid: string, pn: string): Promise<void> {
    if (!lid || !pn) return

    // Find identities for both
    const lidAlias = await prisma.identityAlias.findUnique({ where: { jid: lid } })
    let pnIdentity = await prisma.identity.findUnique({ where: { phoneNumber: pn } })
    
    if (!pnIdentity) {
      // Look for PN alias
      const pnAlias = await prisma.identityAlias.findUnique({ where: { jid: pn } })
      if (pnAlias) {
        pnIdentity = await prisma.identity.findUnique({ where: { id: pnAlias.identityId } })
      }
    }

    let identityId: number

    if (pnIdentity) {
      identityId = pnIdentity.id
      // If LID was attached to a different identity, merge them (ideally) or just re-point the alias
      // For simplicity, we just re-point the alias to the PN's identity
      await prisma.identityAlias.upsert({
        where: { jid: lid },
        update: { identityId },
        create: { jid: lid, type: 'LID', identityId }
      })
    } else if (lidAlias) {
      identityId = lidAlias.identityId
      // Update the identity to have the phone number
      await prisma.identity.update({
        where: { id: identityId },
        data: { phoneNumber: pn }
      })
      await prisma.identityAlias.upsert({
        where: { jid: pn },
        update: { identityId },
        create: { jid: pn, type: 'PN', identityId }
      })
    } else {
      // Neither exists, create a new identity and both aliases
      const newId = await prisma.identity.create({
        data: { phoneNumber: pn }
      })
      identityId = newId.id
      await prisma.identityAlias.create({ data: { jid: pn, type: 'PN', identityId } })
      await prisma.identityAlias.create({ data: { jid: lid, type: 'LID', identityId } })
    }
  }

  /**
   * Internal helper to find an Identity ID by a JID (alias).
   */
  async getIdentityIdByJid(jid: string | any): Promise<number | null> {
    if (!jid) return null
    if (typeof jid === 'object' && jid.id) {
      jid = jid.id
    } else if (typeof jid !== 'string') {
      return null
    }

    const alias = await prisma.identityAlias.findUnique({ where: { jid } })
    if (alias) return alias.identityId
    
    // Fallback: search identity by phone number directly
    if (jid.endsWith('@s.whatsapp.net')) {
      const ident = await prisma.identity.findUnique({ where: { phoneNumber: jid } })
      if (ident) return ident.id
    }
    
    return null
  }

  private imageCache = new Map<string, string>()

  /**
   * Fetches the profile picture URL.
   */
  async getProfilePicture(
    jid: string,
    type: 'preview' | 'image' = 'preview',
    sock?: any,
    forceRefresh: boolean = false
  ): Promise<string | null> {
    if (type === 'image') {
      if (!forceRefresh && this.imageCache.has(jid)) return this.imageCache.get(jid)!
      if (!sock) return null

      try {
        const url = await sock.profilePictureUrl(jid, 'image')
        if (url) this.imageCache.set(jid, url)
        return url
      } catch (e) {
        return null
      }
    }

    if (!forceRefresh) {
      // Check Chat first (groups)
      if (jid.endsWith('@g.us')) {
        const chat = await prisma.chat.findUnique({ where: { jid }, select: { profilePictureUrl: true } })
        if (chat?.profilePictureUrl) return chat.profilePictureUrl
      } else {
        // Check Identity (contacts)
        const identityId = await this.getIdentityIdByJid(jid)
        if (identityId) {
          const ident = await prisma.identity.findUnique({ where: { id: identityId }, select: { profilePictureUrl: true } })
          if (ident?.profilePictureUrl) return ident.profilePictureUrl
        }
      }
    }

    if (!sock) return null

    try {
      const url = await sock.profilePictureUrl(jid, 'preview')
      if (url) {
        if (jid.endsWith('@g.us')) {
          await prisma.chat.update({
            where: { jid },
            data: { profilePictureUrl: url }
          }).catch(() => {})
        } else {
          const identityId = await this.getIdentityIdByJid(jid)
          if (identityId) {
            await prisma.identity.update({
              where: { id: identityId },
              data: { profilePictureUrl: url }
            }).catch(() => {})
          }
        }
      }
      return url
    } catch (e) {
      return null
    }
  }
}

export const contactService = new ContactService()
