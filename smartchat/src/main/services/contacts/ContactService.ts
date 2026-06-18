import { cleanJid } from '../../utils'
import { WASocket } from '../../types'
import { ContactRepository } from './ContactRepository'
import { LidPnLinker } from './LidPnLinker'
import { ContactNameResolver } from './ContactNameResolver'
import { Identity } from '@prisma/client'

export class ContactService {
  private linkCache = new Set<string>()
  private identityIdCache = new Map<string, number>()
  private meJidsCache: string[] | null = null

  constructor(
    private readonly repository: ContactRepository,
    private readonly lidPnLinker: LidPnLinker,
    private readonly nameResolver: ContactNameResolver
  ) {}

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
    return ContactNameResolver.getDisplayName(identity, fallback)
  }

  public clearCaches(): void {
    this.linkCache.clear()
    this.identityIdCache.clear()
    this.meJidsCache = null
    console.log('[ContactService] Caches cleared')
  }

  public async getMeJids(sock?: WASocket | null): Promise<string[]> {
    const jids: string[] = []
    if (sock?.user) {
      const myJid = cleanJid(sock.user.id)
      const myLid = (sock.user as { lid?: string }).lid ? cleanJid((sock.user as { lid?: string }).lid) : null
      if (myJid) jids.push(myJid)
      if (myLid) jids.push(myLid)
    }

    if (this.meJidsCache) {
      return Array.from(new Set([...jids, ...this.meJidsCache]))
    }

    try {
      const meIdent = await this.repository.findMeIdentity()
      if (meIdent) {
        const dbJids = [meIdent.phoneNumber, ...(meIdent.aliases?.map(a => a.jid) || [])].filter(Boolean).map(cleanJid)
        this.meJidsCache = dbJids
        return Array.from(new Set([...jids, ...dbJids]))
      }
    } catch (err) {
      console.error('[ContactService] Failed to fetch me ident for JIDs cache:', err)
    }

    return jids
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
    const meJids = await this.getMeJids(sock)
    return this.nameResolver.batchResolveNames(
      jids,
      meJids,
      (lid, pn, src) => this.linkLidAndPn(lid, pn, src),
      sock
    )
  }

  /**
   * Resolves a single JID into a display name.
   */
  async resolveName(jid: string, chatName: string | null, sock?: WASocket | null): Promise<string> {
    const meJids = await this.getMeJids(sock)
    return this.nameResolver.resolveName(
      jid,
      chatName,
      meJids,
      (lid, pn, src) => this.linkLidAndPn(lid, pn, src),
      sock
    )
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
        const existingById = await this.repository.findIdentityByPhoneNumber(phoneNumber)
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
        const existingByAlias = await this.repository.findIdentityAlias(searchLid)
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
        const existingByAlias = await this.repository.findIdentityAlias(id)
        if (existingByAlias) {
          identityId = existingByAlias.identityId
          this.identityIdCache.set(id, identityId)
        }
      }
    }

    // 4. Check LidMap: if this is a PN JID, a LID stub may already exist for this number.
    //    Reuse that stub instead of creating a duplicate PN identity.
    if (!identityId && phoneNumber) {
      const lidMapEntry = await this.repository.findLidMap(phoneNumber)
      if (lidMapEntry) {
        const lidAlias = await this.repository.findIdentityAlias(lidMapEntry.lid)
        if (lidAlias) {
          identityId = lidAlias.identityId
          this.identityIdCache.set(phoneNumber, identityId)
        }
      }
    }

    // Create the Identity if it doesn't exist
    if (!identityId) {
      const newIdentity = await this.repository.createIdentity({
        phoneNumber: phoneNumber,
        displayName: newName,
        pushName: newNotify,
        verifiedName: newVerifiedName
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
        await this.repository.updateIdentity(identityId, updateData)
      }
    }

    // 2. Ensure Aliases are created and pointing to the correct identity
    const ensureAlias = async (jid: string, type: string) => {
      await this.repository.upsertIdentityAlias(jid, type, identityId as number)
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
    return this.lidPnLinker.linkLidAndPn(lid, pn, source, this.linkCache, this.identityIdCache)
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
        const aliases = await this.repository.findIdentityAliasesMinimal(chunk)
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

    const alias = await this.repository.findIdentityAlias(cleaned)
    if (alias) {
      this.identityIdCache.set(cleaned, alias.identityId)
      return alias.identityId
    }
    
    // Fallback: search identity by phone number directly
    if (cleaned.endsWith('@s.whatsapp.net')) {
      const ident = await this.repository.findIdentityByPhoneNumber(cleaned)
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
      const alias = await this.repository.findIdentityAlias(cleaned)

      if (alias) {
        // Find the LID alias for this identity
        const lidAlias = await this.repository.findLidAliasByIdentityId(alias.identityId)
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
    const existingJidAlias = await this.repository.findIdentityAlias(myJid)
    if (existingJidAlias) {
      identityId = existingJidAlias.identityId;
    }

    if (!identityId && myLid) {
      const existingLidAlias = await this.repository.findIdentityAlias(myLid)
      if (existingLidAlias) {
        identityId = existingLidAlias.identityId;
      }
    }

    // 2. Upsert the Identity row with isMe = true
    if (!identityId) {
      const newIdentity = await this.repository.createIdentity({
        phoneNumber: myJid,
        displayName: name,
        isMe: true
      });
      identityId = newIdentity.id;
    } else {
      await this.repository.updateIdentity(identityId, {
        phoneNumber: myJid,
        isMe: true
      });
    }

    // 3. Ensure aliases are pointing to the isMe identity
    await this.repository.upsertIdentityAlias(myJid, 'PN', identityId)

    if (myLid) {
      await this.repository.upsertIdentityAlias(myLid, 'LID', identityId)

      await this.repository.upsertLidMap(myLid, myJid, 'registerMe').catch((err: unknown) => {
        console.error('[ContactService] Failed to upsert me lidMap entry:', err)
      });
    }

    this.meJidsCache = null;
  }

  /**
   * Find a single identity by ID.
   */
  public async findIdentityById(id: number): Promise<Identity | null> {
    return this.repository.findIdentityById(id)
  }

  /**
   * Resolves the logged-in user's phone number JID.
   */
  public async getMePhoneNumberJid(sock?: WASocket | null): Promise<string | null> {
    const meJids = await this.getMeJids(sock)
    const pnJid = meJids.find(jid => jid.endsWith('@s.whatsapp.net'))
    if (pnJid) return pnJid
    return meJids[0] || null
  }
}
