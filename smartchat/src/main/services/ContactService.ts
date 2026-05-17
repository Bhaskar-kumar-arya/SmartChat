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
        // Tier 3: Runtime Cache Query
        let resolvedFromCache = false;
        if (jid.includes('@lid') && sock?.signalRepository?.lidMapping?.getPNForLID) {
          const pn = sock.signalRepository.lidMapping.getPNForLID(jid);
          if (pn) {
            resolvedFromCache = true;
            // Async fire-and-forget to link them
            this.linkLidAndPn(jid, pn, 'runtime.cache').catch(() => {});
            
            // Re-check aliases just in case PN is known
            const pnAlias = aliases.find(a => a.jid === pn || a.jid === pn.split(':')[0]);
            if (pnAlias && pnAlias.identity) {
              const ident = pnAlias.identity;
              const finalName = ident.displayName || ident.verifiedName || ident.pushName || ident.phoneNumber?.split('@')[0] || pn.split('@')[0]
              nameMap.set(jid, finalName);
            } else {
              nameMap.set(jid, pn.split('@')[0]);
            }
          }
        }
        
        if (!resolvedFromCache) {
          nameMap.set(jid, jid.split('@')[0])
        }
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

    // 4. Check LidMap: if this is a PN JID, a LID stub may already exist for this number.
    //    Reuse that stub instead of creating a duplicate PN identity.
    if (!identityId && phoneNumber) {
      const lidMapEntry = await prisma.lidMap.findFirst({ where: { pn: phoneNumber } })
      if (lidMapEntry) {
        const lidAlias = await prisma.identityAlias.findUnique({ where: { jid: lidMapEntry.lid } })
        if (lidAlias) identityId = lidAlias.identityId
      }
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
  async linkLidAndPn(lid: string, pn: string, source: string = 'unknown'): Promise<void> {
    if (!lid || !pn) return

    // 1. High-Performance Mapping Ledger
    await prisma.lidMap.upsert({
      where: { lid },
      update: { pn, source, lastSeenDateTime: BigInt(Math.floor(Date.now() / 1000)) },
      create: { lid, pn, source, lastSeenDateTime: BigInt(Math.floor(Date.now() / 1000)) }
    }).catch(() => {})

    // 2. Relational Identity Sync
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
      const orphanId = lidAlias && lidAlias.identityId !== identityId ? lidAlias.identityId : null

      // Re-point the LID alias to the canonical PN identity
      await prisma.identityAlias.upsert({
        where: { jid: lid },
        update: { identityId },
        create: { jid: lid, type: 'LID', identityId }
      })

      // Delete the old LID-only stub if nothing else references it
      if (orphanId) {
        const [aliasCount, msgCount, memberCount, reactionCount] = await Promise.all([
          prisma.identityAlias.count({ where: { identityId: orphanId } }),
          prisma.message.count({ where: { senderId: orphanId } }),
          prisma.chatMember.count({ where: { identityId: orphanId } }),
          prisma.reaction.count({ where: { senderId: orphanId } })
        ])
        if (aliasCount === 0 && msgCount === 0 && memberCount === 0 && reactionCount === 0) {
          await prisma.identity.delete({ where: { id: orphanId } }).catch(() => {})
        }
      }
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
   * Resolves many JIDs to their Identity IDs in a single batched query.
   * Does NOT create missing identities — unknown JIDs are simply absent from the result map.
   * Safe to call with large arrays; chunked to stay within SQLite's variable limit.
   */
  async batchGetIdentityIds(jids: string[]): Promise<Map<string, number>> {
    const unique = Array.from(new Set(jids.filter(Boolean)))
    if (unique.length === 0) return new Map()

    const CHUNK = 500
    const result = new Map<string, number>()

    for (let i = 0; i < unique.length; i += CHUNK) {
      const chunk = unique.slice(i, i + CHUNK)
      const aliases = await prisma.identityAlias.findMany({
        where: { jid: { in: chunk } },
        select: { jid: true, identityId: true }
      })
      for (const alias of aliases) {
        result.set(alias.jid, alias.identityId)
      }
    }

    return result
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

  /**
   * Post-sync garbage collector: merges LID-only stubs into their PN counterpart
   * using pushName as the matching heuristic. Only merges when there is exactly
   * one unambiguous PN identity with the same pushName.
   * Safe to call multiple times — fully idempotent.
   */
  async deduplicateIdentities(): Promise<{ merged: number; skipped: number }> {
    let merged = 0
    let skipped = 0

    // Find all LID-only stubs: no phoneNumber, at least one LID alias, non-trivial pushName
    const stubs = await prisma.identity.findMany({
      where: {
        phoneNumber: null,
        pushName: { not: null },
        aliases: { some: { type: 'LID' } }
      },
      include: { aliases: true }
    })

    for (const stub of stubs) {
      const pushName = stub.pushName?.trim()
      if (!pushName || pushName.length < 2) { skipped++; continue }

      // Find PN identities with the same pushName
      const candidates = await prisma.identity.findMany({
        where: {
          phoneNumber: { not: null },
          pushName: pushName,
          id: { not: stub.id }
        }
      })

      // Only merge on unambiguous 1:1 match — if 2+ candidates, we can't be sure which is right
      if (candidates.length !== 1) { skipped++; continue }

      const keep = candidates[0]
      const keepId = keep.id
      const stubId = stub.id

      try {
        // 1. Re-point all LID aliases from stub → keep
        await prisma.identityAlias.updateMany({
          where: { identityId: stubId },
          data: { identityId: keepId }
        })

        // 2. Re-point messages
        await prisma.message.updateMany({
          where: { senderId: stubId },
          data: { senderId: keepId }
        })

        // 3. Merge ChatMember rows — handle composite PK conflicts
        const stubMemberships = await prisma.chatMember.findMany({ where: { identityId: stubId } })
        for (const m of stubMemberships) {
          const conflict = await prisma.chatMember.findUnique({
            where: { chatJid_identityId: { chatJid: m.chatJid, identityId: keepId } }
          })
          if (conflict) {
            await prisma.chatMember.delete({
              where: { chatJid_identityId: { chatJid: m.chatJid, identityId: stubId } }
            })
          } else {
            await prisma.chatMember.update({
              where: { chatJid_identityId: { chatJid: m.chatJid, identityId: stubId } },
              data: { identityId: keepId }
            })
          }
        }

        // 4. Merge Reactions — handle composite PK conflicts
        const stubReactions = await prisma.reaction.findMany({ where: { senderId: stubId } })
        for (const r of stubReactions) {
          const conflict = await prisma.reaction.findUnique({
            where: { messageId_senderId: { messageId: r.messageId, senderId: keepId } }
          })
          if (conflict) {
            await prisma.reaction.delete({
              where: { messageId_senderId: { messageId: r.messageId, senderId: stubId } }
            })
          } else {
            await prisma.reaction.update({
              where: { messageId_senderId: { messageId: r.messageId, senderId: stubId } },
              data: { senderId: keepId }
            })
          }
        }

        // 5. Enrich the survivor with any unique data the stub held
        const enrichUpdate: any = {}
        if (!keep.displayName && stub.displayName) enrichUpdate.displayName = stub.displayName
        if (!keep.verifiedName && stub.verifiedName) enrichUpdate.verifiedName = stub.verifiedName
        if (!keep.profilePictureUrl && stub.profilePictureUrl) enrichUpdate.profilePictureUrl = stub.profilePictureUrl
        if (Object.keys(enrichUpdate).length > 0) {
          await prisma.identity.update({ where: { id: keepId }, data: enrichUpdate }).catch(() => {})
        }

        // 6. Delete the now-empty stub
        await prisma.identity.delete({ where: { id: stubId } })

        merged++
        console.log(`[deduplicateIdentities] Merged stub id=${stubId} ("${pushName}") → id=${keepId} (${keep.phoneNumber})`)
      } catch (err) {
        console.warn(`[deduplicateIdentities] Failed to merge stub id=${stubId}:`, err)
        skipped++
      }
    }

    console.log(`[deduplicateIdentities] Complete — merged: ${merged}, skipped: ${skipped} (ambiguous/no-match)`)
    return { merged, skipped }
  }
}

export const contactService = new ContactService()
