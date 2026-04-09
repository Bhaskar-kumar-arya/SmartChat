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

    const contacts = await prisma.contact.findMany({
      where: {
        OR: [
          { id: { in: uniqueJids } },
          { lid: { in: uniqueJids } },
          { phoneNumber: { in: uniqueJids } }
        ]
      }
    })

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

      // 2. Find matching records (could be multiple if LID mapping exists)
      const matching = contacts.filter(
        c => c.id === jid || c.lid === jid || c.phoneNumber === jid ||
             c.id === jid.split(':')[0] || c.lid === jid.split(':')[0]
      )

      let phonebookName: string | null = null
      let pushName: string | null = null
      let verifiedName: string | null = null
      let linkedPhone: string | null = null

      for (const c of matching) {
        if (!c.id.includes('@lid') && c.name) phonebookName = c.name
        if (c.verifiedName) verifiedName = c.verifiedName
        if (c.notify) pushName = c.notify
        else if (c.id.includes('@lid') && c.name) pushName = c.name
        if (c.phoneNumber) linkedPhone = c.phoneNumber
      }

      const finalName = phonebookName || verifiedName || pushName || linkedPhone?.replace(/@.*$/, '') || jid.split('@')[0]
      nameMap.set(jid, finalName)
    }

    return nameMap
  }

  /**
   * Resolves a single JID into a display name.
   */
  async resolveName(jid: string, chatName: string | null, sock?: any): Promise<string> {
    const map = await this.batchResolveNames([jid], sock)
    const resolved = map.get(jid)
    return resolved || chatName || jid.split('@')[0]
  }

  /**
   * Handles contacts.upsert and contacts.update logic.
   */
  async upsertContact(contact: any, options: { overwriteName?: boolean } = {}): Promise<void> {
    const id = contact.id
    if (!id) return

    const lid = contact.lid
    const phoneNumber = contact.phoneNumber
    const newName = contact.name
    const newNotify = contact.notify ?? contact.pushName
    const newVerifiedName = contact.verifiedName

    // Clear conflicting LID from other records first if this is a PN record
    if (id.endsWith('@s.whatsapp.net') && lid) {
        await prisma.contact.updateMany({
            where: { lid, id: { not: id } },
            data: { lid: null }
        }).catch(() => {})
    }

    const existing = await prisma.contact.findUnique({ where: { id } })
    const data: any = { id }

    // Only set LID mapping for PN-based records to avoid unique constraint issues.
    if (id.endsWith('@s.whatsapp.net')) {
      if (lid) data.lid = lid
    } else {
      data.lid = null
    }

    if (phoneNumber) data.phoneNumber = phoneNumber
    if (newNotify !== undefined) data.notify = newNotify
    if (newVerifiedName !== undefined) data.verifiedName = newVerifiedName
    
    if (newName !== undefined) {
      if (options.overwriteName || !existing || !existing.name) {
        data.name = newName
      }
    }

    await prisma.contact.upsert({
      where: { id },
      update: data,
      create: data
    })

    // Cross-update logic: if we just updated a PN record with a LID, 
    // we should make sure the LID record points back to the PN.
    if (id.endsWith('@s.whatsapp.net') && (lid || data.lid)) {
        const currentLid = lid || data.lid
        const existingByLid = await prisma.contact.findFirst({ where: { lid: currentLid } })
        if (existingByLid && existingByLid.id !== id) {
            await prisma.contact.update({
                where: { id: existingByLid.id },
                data: { phoneNumber: id, lid: null }
            }).catch(() => {})
        }
    } else if (id.endsWith('@lid') && (phoneNumber || data.phoneNumber)) {
        const currentPn = phoneNumber || data.phoneNumber
        const existingByPn = await prisma.contact.findUnique({ where: { id: currentPn } })
        if (existingByPn) {
            await prisma.contact.update({
                where: { id: existingByPn.id },
                data: { lid: id }
            }).catch(() => {})
        }
    }
  }

  async linkLidAndPn(lid: string, pn: string): Promise<void> {
    if (!lid || !pn) return

    // Clear this LID from any other record to satisfy unique constraint
    await prisma.contact.updateMany({
      where: { lid, id: { not: pn } },
      data: { lid: null }
    })

    // Update the PN record with the LID
    await prisma.contact.upsert({
      where: { id: pn },
      update: { lid },
      create: { id: pn, lid }
    })

    // Update the LID record with the PN
    await prisma.contact.upsert({
      where: { id: lid },
      update: { phoneNumber: pn, lid: null },
      create: { id: lid, phoneNumber: pn, lid: null }
    })
  }
  private imageCache = new Map<string, string>()

  /**
   * Fetches the profile picture URL.
   * - For 'preview': check DB first, then fetch from sock and save to DB.
   * - For 'image': check memory cache first, then fetch from sock and save to memory cache.
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
        console.error(`[ContactService] Failed to fetch full profile picture for ${jid}`, e)
        return null
      }
    }

    // Default: 'preview'
    if (!forceRefresh) {
      const contact = await prisma.contact.findUnique({
        where: { id: jid },
        select: { profilePictureUrl: true } as any
      }) as any

      if (contact?.profilePictureUrl) return contact.profilePictureUrl
    }

    if (!sock) return null

    try {
      const url = await sock.profilePictureUrl(jid, 'preview')
      if (url) {
        // Save to both Contact and Chat for redundancy and easy access
        await prisma.contact.update({
          where: { id: jid },
          data: { profilePictureUrl: url } as any
        }).catch(() => {})

        await prisma.chat.update({
          where: { jid },
          data: { profilePictureUrl: url } as any
        }).catch(() => {})
      }
      return url
    } catch (e) {
      // Baileys might throw 404/401 if no picture is set
      return null
    }
  }
}

export const contactService = new ContactService()
