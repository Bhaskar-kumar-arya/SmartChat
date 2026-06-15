import { PrismaClient } from '@prisma/client'
import { cleanJid } from '../../utils'
import { WASocket, WASocketWithSignalRepository } from '../../types'

function hasSignalRepository(sock: WASocket | null | undefined): sock is WASocket & WASocketWithSignalRepository {
  return !!sock && typeof sock === 'object' && 'signalRepository' in sock
}

export class ContactService {
  private linkCache = new Set<string>()
  private identityIdCache = new Map<string, number>()

  constructor(private prisma: PrismaClient) {}

  /**
   * Formats display name from an Identity object.
   */
  public static getDisplayName(
    identity: {
      displayName?: string | null
      verifiedName?: string | null
      pushName?: string | null
      phoneNumber?: string | null
    } | null | undefined,
    fallback: string = 'Unknown'
  ): string {
    if (!identity) return fallback
    if (identity.displayName) return identity.displayName
    if (identity.verifiedName) return identity.verifiedName
    if (identity.pushName) {
      const trimmed = identity.pushName.trim()
      if (trimmed) {
        return trimmed.startsWith('~') ? trimmed : `~ ${trimmed}`
      }
    }
    return identity.phoneNumber?.split('@')[0] || fallback
  }

  public clearCaches(): void {
    this.linkCache.clear()
    this.identityIdCache.clear()
    console.log('[ContactService] Caches cleared')
  }

  public warmLinkCache(cacheKey: string): void {
    this.linkCache.add(cacheKey)
  }

  public populateIdentityIdCache(entries: Map<string, number>): void {
    for (const [jid, id] of entries) {
      this.identityIdCache.set(jid, id)
    }
  }

  /**
   * Resolves a collection of JIDs into a map of display names.
   * Efficiently handles the N+1 problem by batching DB requests.
   */
  async batchResolveNames(
    jids: string[],
    sock?: WASocket | null
  ): Promise<Map<string, string>> {
    const uniqueJids = Array.from(new Set(jids.filter(Boolean).map(cleanJid)))
    if (uniqueJids.length === 0) return new Map()

    const BATCH_SIZE = 250
    const aliases: any[] = []
    
    for (let i = 0; i < uniqueJids.length; i += BATCH_SIZE) {
      const chunk = uniqueJids.slice(i, i + BATCH_SIZE)
      const res = await this.prisma.identityAlias.findMany({
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
        myLid = (sock.user as { lid?: string }).lid ? cleanJid((sock.user as { lid?: string }).lid) : null
    }

    for (const jid of uniqueJids) {
      // 1. Is it "Me"?
      if (myJid && (jid === myJid || jid === myLid)) {
        nameMap.set(jid, sock?.user?.name || 'Me')
        continue
      }

      // 2. Find matching alias
      const alias = aliases.find(a => a.jid === jid)
      
      if (alias && alias.identity) {
        const ident = alias.identity
        const finalName = ContactService.getDisplayName(ident, jid.split('@')[0])
        nameMap.set(jid, finalName)
      } else {
        // Tier 3: Runtime Cache Query
        let resolvedFromCache = false;
        if (jid.includes('@lid') && hasSignalRepository(sock) && sock.signalRepository?.lidMapping?.getPNForLID) {
          const pn = cleanJid(sock.signalRepository.lidMapping.getPNForLID(jid));
          if (pn) {
            resolvedFromCache = true;
            // Async fire-and-forget to link them
            this.linkLidAndPn(jid, pn, 'runtime.cache').catch(() => {});
            
            // Re-check aliases just in case PN is known
            const pnAlias = aliases.find(a => a.jid === pn);
            if (pnAlias && pnAlias.identity) {
              const ident = pnAlias.identity;
              const finalName = ContactService.getDisplayName(ident, pn.split('@')[0])
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
  async resolveName(jid: string, chatName: string | null, sock?: WASocket | null): Promise<string> {
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
  async upsertContact(
    contact: {
      id: string
      lid?: string | null
      phoneNumber?: string | null
      name?: string | null
      notify?: string | null
      pushName?: string | null
      verifiedName?: string | null
    },
    options: { overwriteName?: boolean } = {}
  ): Promise<void> {
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
        const existingById = await this.prisma.identity.findUnique({ where: { phoneNumber } })
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
        const existingByAlias = await this.prisma.identityAlias.findUnique({ where: { jid: searchLid } })
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
        const existingByAlias = await this.prisma.identityAlias.findUnique({ where: { jid: id } })
        if (existingByAlias) {
          identityId = existingByAlias.identityId
          this.identityIdCache.set(id, identityId)
        }
      }
    }

    // 4. Check LidMap: if this is a PN JID, a LID stub may already exist for this number.
    //    Reuse that stub instead of creating a duplicate PN identity.
    if (!identityId && phoneNumber) {
      const lidMapEntry = await this.prisma.lidMap.findFirst({ where: { pn: phoneNumber } })
      if (lidMapEntry) {
        const lidAlias = await this.prisma.identityAlias.findUnique({ where: { jid: lidMapEntry.lid } })
        if (lidAlias) {
          identityId = lidAlias.identityId
          this.identityIdCache.set(phoneNumber, identityId)
        }
      }
    }

    // Create the Identity if it doesn't exist
    if (!identityId) {
      const newIdentity = await this.prisma.identity.create({
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
      const updateData: {
        phoneNumber?: string
        pushName?: string | null
        verifiedName?: string | null
        displayName?: string | null
      } = {}
      if (phoneNumber) updateData.phoneNumber = phoneNumber // Ensure PN is attached if we just discovered it
      if (newNotify !== undefined) updateData.pushName = newNotify
      if (newVerifiedName !== undefined) updateData.verifiedName = newVerifiedName
      if (newName !== undefined && options.overwriteName) {
        updateData.displayName = newName
      }

      if (Object.keys(updateData).length > 0) {
        await this.prisma.identity.update({
          where: { id: identityId },
          data: updateData
        })
      }
    }

    // 2. Ensure Aliases are created and pointing to the correct identity
    const ensureAlias = async (jid: string, type: string) => {
      await this.prisma.identityAlias.upsert({
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
    await this.prisma.lidMap.upsert({
      where: { lid: cleanLid },
      update: { pn: cleanPn, source, lastSeenDateTime: BigInt(Math.floor(Date.now() / 1000)) },
      create: { lid: cleanLid, pn: cleanPn, source, lastSeenDateTime: BigInt(Math.floor(Date.now() / 1000)) }
    }).catch(() => {})

    // 2. Relational Identity Sync
    // Find identities for both
    const lidAlias = await this.prisma.identityAlias.findUnique({ where: { jid: cleanLid } })
    let pnIdentity = await this.prisma.identity.findUnique({ where: { phoneNumber: cleanPn } })
    
    if (!pnIdentity) {
      // Look for PN alias
      const pnAlias = await this.prisma.identityAlias.findUnique({ where: { jid: cleanPn } })
      if (pnAlias) {
        pnIdentity = await this.prisma.identity.findUnique({ where: { id: pnAlias.identityId } })
      }
    }

    let identityId: number

    if (pnIdentity) {
      identityId = pnIdentity.id
      const orphanId = lidAlias && lidAlias.identityId !== identityId ? lidAlias.identityId : null

      // Re-point the LID alias to the canonical PN identity
      await this.prisma.identityAlias.upsert({
        where: { jid: cleanLid },
        update: { identityId },
        create: { jid: cleanLid, type: 'LID', identityId }
      })

      // Delete the old LID-only stub if nothing else references it
      if (orphanId) {
        const [aliasCount, msgCount, memberCount, reactionCount] = await Promise.all([
          this.prisma.identityAlias.count({ where: { identityId: orphanId } }),
          this.prisma.message.count({ where: { senderId: orphanId } }),
          this.prisma.chatMember.count({ where: { identityId: orphanId } }),
          this.prisma.reaction.count({ where: { senderId: orphanId } })
        ])
        if (aliasCount === 0 && msgCount === 0 && memberCount === 0 && reactionCount === 0) {
          await this.prisma.identity.delete({ where: { id: orphanId } }).catch(() => {})
        }
      }
    } else if (lidAlias) {
      identityId = lidAlias.identityId
      // Update the identity to have the phone number
      await this.prisma.identity.update({
        where: { id: identityId },
        data: { phoneNumber: cleanPn }
      })
      await this.prisma.identityAlias.upsert({
        where: { jid: cleanPn },
        update: { identityId },
        create: { jid: cleanPn, type: 'PN', identityId }
      })
    } else {
      // Neither exists, create a new identity and both aliases
      const newId = await this.prisma.identity.create({
        data: { phoneNumber: cleanPn }
      })
      identityId = newId.id
      await this.prisma.identityAlias.create({ data: { jid: cleanPn, type: 'PN', identityId } })
      await this.prisma.identityAlias.create({ data: { jid: cleanLid, type: 'LID', identityId } })
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
        const aliases = await this.prisma.identityAlias.findMany({
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
  async getIdentityIdByJid(jid: string | { id: string } | null | undefined): Promise<number | null> {
    if (!jid) return null
    let targetJid: string
    if (typeof jid === 'object') {
      if (!jid.id) return null
      targetJid = jid.id
    } else {
      targetJid = jid
    }

    const cleaned = cleanJid(targetJid)
    if (this.identityIdCache.has(cleaned)) {
      return this.identityIdCache.get(cleaned)!
    }

    const alias = await this.prisma.identityAlias.findUnique({ where: { jid: cleaned } })
    if (alias) {
      this.identityIdCache.set(cleaned, alias.identityId)
      return alias.identityId
    }
    
    // Fallback: search identity by phone number directly
    if (cleaned.endsWith('@s.whatsapp.net')) {
      const ident = await this.prisma.identity.findUnique({ where: { phoneNumber: cleaned } })
      if (ident) {
        this.identityIdCache.set(cleaned, ident.id)
        return ident.id
      }
    }
    
    return null
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
      const alias = await this.prisma.identityAlias.findUnique({
        where: { jid: cleaned },
        select: { identityId: true }
      });

      if (alias) {
        // Find the LID alias for this identity
        const lidAlias = await this.prisma.identityAlias.findFirst({
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
    const existingJidAlias = await this.prisma.identityAlias.findUnique({ where: { jid: myJid } });
    if (existingJidAlias) {
      identityId = existingJidAlias.identityId;
    }

    if (!identityId && myLid) {
      const existingLidAlias = await this.prisma.identityAlias.findUnique({ where: { jid: myLid } });
      if (existingLidAlias) {
        identityId = existingLidAlias.identityId;
      }
    }

    // 2. Upsert the Identity row with isMe = true
    if (!identityId) {
      const newIdentity = await this.prisma.identity.create({
        data: {
          phoneNumber: myJid,
          displayName: name,
          isMe: true
        }
      });
      identityId = newIdentity.id;
    } else {
      await this.prisma.identity.update({
        where: { id: identityId },
        data: {
          phoneNumber: myJid,
          isMe: true
        }
      });
    }

    // 3. Ensure aliases are pointing to the isMe identity
    await this.prisma.identityAlias.upsert({
      where: { jid: myJid },
      update: { identityId, type: 'PN' },
      create: { jid: myJid, type: 'PN', identityId }
    });

    if (myLid) {
      await this.prisma.identityAlias.upsert({
        where: { jid: myLid },
        update: { identityId, type: 'LID' },
        create: { jid: myLid, type: 'LID', identityId }
      });

      await this.prisma.lidMap.upsert({
        where: { lid: myLid },
        update: { pn: myJid, source: 'registerMe', lastSeenDateTime: BigInt(Math.floor(Date.now() / 1000)) },
        create: { lid: myLid, pn: myJid, source: 'registerMe', lastSeenDateTime: BigInt(Math.floor(Date.now() / 1000)) }
      }).catch(() => {});
    }
  }
}
