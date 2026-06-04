import { prisma } from '../../auth'
import { cleanJid } from '../../utils'

export class ContactService {
  private linkCache = new Set<string>()
  private identityIdCache = new Map<string, number>()

  public clearCaches(): void {
    this.linkCache.clear()
    this.identityIdCache.clear()
    console.log('[ContactService] Caches cleared')
  }

  /**
   * Resolves a collection of JIDs into a map of display names.
   * Efficiently handles the N+1 problem by batching DB requests.
   */
  async batchResolveNames(
    jids: string[],
    sock?: any
  ): Promise<Map<string, string>> {
    const uniqueJids = Array.from(new Set(jids.filter(Boolean).map(cleanJid)))
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
        myJid = cleanJid(sock.user.id)
        myLid = (sock.user as any).lid ? cleanJid((sock.user as any).lid) : null
    }


    for (const jid of uniqueJids) {
      // 1. Is it "Me"?
      if (myJid && (jid === myJid || jid === myLid)) {
        nameMap.set(jid, sock.user.name || 'Me')
        continue
      }

      // 2. Find matching alias
      const alias = aliases.find(a => a.jid === jid)
      
      if (alias && alias.identity) {
        const ident = alias.identity
        const finalName = ident.displayName || ident.verifiedName || ident.pushName || ident.phoneNumber?.split('@')[0] || jid.split('@')[0]
        nameMap.set(jid, finalName)
      } else {
        // Tier 3: Runtime Cache Query
        let resolvedFromCache = false;
        if (jid.includes('@lid') && sock?.signalRepository?.lidMapping?.getPNForLID) {
          const pn = cleanJid(sock.signalRepository.lidMapping.getPNForLID(jid));
          if (pn) {
            resolvedFromCache = true;
            // Async fire-and-forget to link them
            this.linkLidAndPn(jid, pn, 'runtime.cache').catch(() => {});
            
            // Re-check aliases just in case PN is known
            const pnAlias = aliases.find(a => a.jid === pn);
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
    const cleaned = cleanJid(jid)
    const map = await this.batchResolveNames([cleaned], sock)
    const resolved = map.get(cleaned)
    // If it's just the raw number (fallback), and we have a chatName, use the chatName
    if (resolved === cleaned.split('@')[0] && chatName) {
      return chatName
    }
    return resolved || chatName || cleaned.split('@')[0]
  }

  /**
   * Handles contacts.upsert and contacts.update logic.
   */
  async upsertContact(contact: any, options: { overwriteName?: boolean } = {}): Promise<void> {
    const id = cleanJid(contact.id)
    if (!id) return

    const lid = contact.lid ? cleanJid(contact.lid) : null
    const phoneNumber = contact.phoneNumber ? cleanJid(contact.phoneNumber) : (id.endsWith('@s.whatsapp.net') ? id : null)
    const newName = contact.name
    const newNotify = contact.notify ?? contact.pushName
    const newVerifiedName = contact.verifiedName

    // 1. Identify or Create the Canonical Identity
    let identityId: number | null = null

    // Look for existing identity by phone number
    if (phoneNumber) {
      if (this.identityIdCache.has(phoneNumber)) {
        identityId = this.identityIdCache.get(phoneNumber)!
      } else {
        const existingById = await prisma.identity.findUnique({ where: { phoneNumber } })
        if (existingById) {
          identityId = existingById.id
          this.identityIdCache.set(phoneNumber, identityId)
        }
      }
    }

    // Look for existing identity by LID alias if not found by PN
    if (!identityId && (lid || id.endsWith('@lid'))) {
      const searchLid = lid || id
      if (this.identityIdCache.has(searchLid)) {
        identityId = this.identityIdCache.get(searchLid)!
      } else {
        const existingByAlias = await prisma.identityAlias.findUnique({ where: { jid: searchLid } })
        if (existingByAlias) {
          identityId = existingByAlias.identityId
          this.identityIdCache.set(searchLid, identityId)
        }
      }
    }

    // Still not found? Look for existing identity by the JID alias itself
    if (!identityId) {
      if (this.identityIdCache.has(id)) {
        identityId = this.identityIdCache.get(id)!
      } else {
        const existingByAlias = await prisma.identityAlias.findUnique({ where: { jid: id } })
        if (existingByAlias) {
          identityId = existingByAlias.identityId
          this.identityIdCache.set(id, identityId)
        }
      }
    }

    // 4. Check LidMap: if this is a PN JID, a LID stub may already exist for this number.
    //    Reuse that stub instead of creating a duplicate PN identity.
    if (!identityId && phoneNumber) {
      const lidMapEntry = await prisma.lidMap.findFirst({ where: { pn: phoneNumber } })
      if (lidMapEntry) {
        const lidAlias = await prisma.identityAlias.findUnique({ where: { jid: lidMapEntry.lid } })
        if (lidAlias) {
          identityId = lidAlias.identityId
          this.identityIdCache.set(phoneNumber, identityId)
        }
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
      if (phoneNumber) this.identityIdCache.set(phoneNumber, identityId)
      this.identityIdCache.set(id, identityId)
      if (lid) this.identityIdCache.set(lid, identityId)
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
      this.identityIdCache.set(jid, identityId as number)
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
    const cleanLid = cleanJid(lid)
    const cleanPn = cleanJid(pn)
    if (!cleanLid || !cleanPn) return

    const cacheKey = `${cleanLid}->${cleanPn}`
    if (this.linkCache.has(cacheKey)) {
      return
    }

    // 1. High-Performance Mapping Ledger
    await prisma.lidMap.upsert({
      where: { lid: cleanLid },
      update: { pn: cleanPn, source, lastSeenDateTime: BigInt(Math.floor(Date.now() / 1000)) },
      create: { lid: cleanLid, pn: cleanPn, source, lastSeenDateTime: BigInt(Math.floor(Date.now() / 1000)) }
    }).catch(() => {})

    // 2. Relational Identity Sync
    // Find identities for both
    const lidAlias = await prisma.identityAlias.findUnique({ where: { jid: cleanLid } })
    let pnIdentity = await prisma.identity.findUnique({ where: { phoneNumber: cleanPn } })
    
    if (!pnIdentity) {
      // Look for PN alias
      const pnAlias = await prisma.identityAlias.findUnique({ where: { jid: cleanPn } })
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
        where: { jid: cleanLid },
        update: { identityId },
        create: { jid: cleanLid, type: 'LID', identityId }
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
        data: { phoneNumber: cleanPn }
      })
      await prisma.identityAlias.upsert({
        where: { jid: cleanPn },
        update: { identityId },
        create: { jid: cleanPn, type: 'PN', identityId }
      })
    } else {
      // Neither exists, create a new identity and both aliases
      const newId = await prisma.identity.create({
        data: { phoneNumber: cleanPn }
      })
      identityId = newId.id
      await prisma.identityAlias.create({ data: { jid: cleanPn, type: 'PN', identityId } })
      await prisma.identityAlias.create({ data: { jid: cleanLid, type: 'LID', identityId } })
    }

    this.identityIdCache.set(cleanLid, identityId)
    this.identityIdCache.set(cleanPn, identityId)
    this.linkCache.add(cacheKey)
  }

  /**
   * Resolves many JIDs to their Identity IDs in a single batched query.
   * Does NOT create missing identities — unknown JIDs are simply absent from the result map.
   * Safe to call with large arrays; chunked to stay within SQLite's variable limit.
   */
  async batchGetIdentityIds(jids: string[]): Promise<Map<string, number>> {
    const unique = Array.from(new Set(jids.filter(Boolean).map(cleanJid)))
    if (unique.length === 0) return new Map()

    const result = new Map<string, number>()
    const missing: string[] = []

    for (const jid of unique) {
      if (this.identityIdCache.has(jid)) {
        result.set(jid, this.identityIdCache.get(jid)!)
      } else {
        missing.push(jid)
      }
    }

    if (missing.length > 0) {
      const CHUNK = 500
      for (let i = 0; i < missing.length; i += CHUNK) {
        const chunk = missing.slice(i, i + CHUNK)
        const aliases = await prisma.identityAlias.findMany({
          where: { jid: { in: chunk } },
          select: { jid: true, identityId: true }
        })
        for (const alias of aliases) {
          result.set(alias.jid, alias.identityId)
          this.identityIdCache.set(alias.jid, alias.identityId)
        }
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

    const cleaned = cleanJid(jid)
    if (this.identityIdCache.has(cleaned)) {
      return this.identityIdCache.get(cleaned)!
    }

    const alias = await prisma.identityAlias.findUnique({ where: { jid: cleaned } })
    if (alias) {
      this.identityIdCache.set(cleaned, alias.identityId)
      return alias.identityId
    }
    
    // Fallback: search identity by phone number directly
    if (cleaned.endsWith('@s.whatsapp.net')) {
      const ident = await prisma.identity.findUnique({ where: { phoneNumber: cleaned } })
      if (ident) {
        this.identityIdCache.set(cleaned, ident.id)
        return ident.id
      }
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

  /**
   * Resolves the Linked JID (@lid) for a given JID if it is a phone JID and has a mapped LID.
   * Falls back to the original JID if no mapping is found.
   */
  async resolveLidFromJid(jid: string): Promise<string> {
    if (!jid) return jid;
    const cleaned = cleanJid(jid);
    if (!cleaned.endsWith('@s.whatsapp.net')) return cleaned;

    try {
      // Find matching identity alias
      const alias = await prisma.identityAlias.findUnique({
        where: { jid: cleaned },
        select: { identityId: true }
      });

      if (alias) {
        // Find the LID alias for this identity
        const lidAlias = await prisma.identityAlias.findFirst({
          where: { identityId: alias.identityId, type: 'LID' },
          select: { jid: true }
        });
        if (lidAlias) {
          return lidAlias.jid;
        }
      }
    } catch (err) {
      console.warn(`[ContactService] Failed to resolve LID for JID ${jid}:`, err);
    }
    return cleaned;
  }

  /**
   * Registers/updates the logged-in user's identity as `isMe: true`.
   */
  async registerMe(user: { id: string; name?: string; lid?: string }): Promise<void> {
    const rawJid = user.id;
    if (!rawJid) return;

    const myJid = cleanJid(rawJid);
    const myLid = user.lid ? cleanJid(user.lid) : null;
    const name = user.name || 'Me';

    console.log(`[ContactService] Registering logged-in user: jid=${myJid}, lid=${myLid}, name=${name}`);

    let identityId: number | null = null;

    // 1. Try to find existing identity alias
    const existingJidAlias = await prisma.identityAlias.findUnique({ where: { jid: myJid } });
    if (existingJidAlias) {
      identityId = existingJidAlias.identityId;
    }

    if (!identityId && myLid) {
      const existingLidAlias = await prisma.identityAlias.findUnique({ where: { jid: myLid } });
      if (existingLidAlias) {
        identityId = existingLidAlias.identityId;
      }
    }

    // 2. Upsert the Identity row with isMe = true
    if (!identityId) {
      const newIdentity = await prisma.identity.create({
        data: {
          phoneNumber: myJid,
          displayName: name,
          isMe: true
        }
      });
      identityId = newIdentity.id;
    } else {
      await prisma.identity.update({
        where: { id: identityId },
        data: {
          phoneNumber: myJid,
          isMe: true
        }
      });
    }

    // 3. Ensure aliases are pointing to the isMe identity
    await prisma.identityAlias.upsert({
      where: { jid: myJid },
      update: { identityId, type: 'PN' },
      create: { jid: myJid, type: 'PN', identityId }
    });

    if (myLid) {
      await prisma.identityAlias.upsert({
        where: { jid: myLid },
        update: { identityId, type: 'LID' },
        create: { jid: myLid, type: 'LID', identityId }
      });

      await prisma.lidMap.upsert({
        where: { lid: myLid },
        update: { pn: myJid, source: 'registerMe', lastSeenDateTime: BigInt(Math.floor(Date.now() / 1000)) },
        create: { lid: myLid, pn: myJid, source: 'registerMe', lastSeenDateTime: BigInt(Math.floor(Date.now() / 1000)) }
      }).catch(() => {});
    }
  }
}

export const contactService = new ContactService()
