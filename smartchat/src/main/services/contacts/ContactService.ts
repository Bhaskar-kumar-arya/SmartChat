import { cleanJid } from '../../utils/jidUtils'
import { WASocket } from '../whatsapp/types'
import { IIdentityRepository } from './IIdentityRepository'
import { IAliasRepository } from './IAliasRepository'
import { ILidMapRepository } from './ILidMapRepository'
import { ILidPnLinker } from './ILidPnLinker'
import { IContactNameResolver, IContactService } from './IContactService'
import { getDisplayName } from '../../utils/contactUtils'
import { Identity } from '@prisma/client'
import { IContactCache } from './IContactCache'
import { IJidStrategy } from './IJidStrategy'

export class ContactService implements IContactService {
  constructor(
    private readonly identityRepository: IIdentityRepository,
    private readonly aliasRepository: IAliasRepository,
    private readonly lidMapRepository: ILidMapRepository,
    private readonly lidPnLinker: ILidPnLinker,
    private readonly nameResolver: IContactNameResolver,
    private readonly cache: IContactCache,
    private readonly strategies: IJidStrategy[]
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
    return getDisplayName(identity, fallback)
  }

  public clearCaches(): void {
    this.cache.clear()
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

    const cachedMeJids = this.cache.getMeJids()
    if (cachedMeJids) {
      return Array.from(new Set([...jids, ...cachedMeJids]))
    }

    try {
      const meIdent = await this.identityRepository.findMeIdentity()
      if (meIdent) {
        const dbJids = [meIdent.phoneNumber, ...(meIdent.aliases?.map(a => a.jid) || [])].filter(Boolean).map(cleanJid)
        this.cache.setMeJids(dbJids)
        return Array.from(new Set([...jids, ...dbJids]))
      }
    } catch (err) {
      console.error('[ContactService] Failed to fetch me ident for JIDs cache:', err)
    }

    return jids
  }

  public warmLinkCache(cacheKey: string): void {
    this.cache.addLink(cacheKey)
  }

  public populateIdentityIdCache(entries: Map<string, number>): void {
    this.cache.populateIdentityIdCache(entries)
  }

  /**
   * Resolves a collection of JIDs into a map of display names.
   * Efficiently handles the N+1 problem by batching DB requests.
   */
  async batchResolveNames(
    jids: string[],
    sock?: WASocket | null
  ): Promise<Map<string, string>> {
    return this.nameResolver.batchResolveNames(jids, sock)
  }

  /**
   * Resolves a single JID into a display name.
   */
  async resolveName(jid: string, chatName: string | null, sock?: WASocket | null): Promise<string> {
    return this.nameResolver.resolveName(jid, chatName, sock)
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
      if (this.cache.hasIdentityId(phoneNumber)) {
        identityId = this.cache.getIdentityId(phoneNumber)!
      } else {
        const existingById = await this.identityRepository.findIdentityByPhoneNumber(phoneNumber)
        if (existingById) {
          identityId = existingById.id
          this.cache.setIdentityId(phoneNumber, identityId)
        }
      }
    }

    // Look for existing identity by LID alias if not found by PN
    if (!identityId && (lid || id.endsWith('@lid'))) {
      const searchLid = lid || id
      if (this.cache.hasIdentityId(searchLid)) {
        identityId = this.cache.getIdentityId(searchLid)!
      } else {
        const existingByAlias = await this.aliasRepository.findIdentityAlias(searchLid)
        if (existingByAlias) {
          identityId = existingByAlias.identityId
          this.cache.setIdentityId(searchLid, identityId)
        }
      }
    }

    // Still not found? Look for existing identity by the JID alias itself
    if (!identityId) {
      if (this.cache.hasIdentityId(id)) {
        identityId = this.cache.getIdentityId(id)!
      } else {
        const existingByAlias = await this.aliasRepository.findIdentityAlias(id)
        if (existingByAlias) {
          identityId = existingByAlias.identityId
          this.cache.setIdentityId(id, identityId)
        }
      }
    }

    // 4. Check LidMap: if this is a PN JID, a LID stub may already exist for this number.
    //    Reuse that stub instead of creating a duplicate PN identity.
    if (!identityId && phoneNumber) {
      const lidMapEntry = await this.lidMapRepository.findLidMap(phoneNumber)
      if (lidMapEntry) {
        const lidAlias = await this.aliasRepository.findIdentityAlias(lidMapEntry.lid)
        if (lidAlias) {
          identityId = lidAlias.identityId
          this.cache.setIdentityId(phoneNumber, identityId)
        }
      }
    }

    // Create the Identity if it doesn't exist
    if (!identityId) {
      const newIdentity = await this.identityRepository.createIdentity({
        phoneNumber: phoneNumber,
        displayName: newName,
        pushName: newNotify,
        verifiedName: newVerifiedName
      })
      identityId = newIdentity.id
      if (phoneNumber) this.cache.setIdentityId(phoneNumber, identityId)
      this.cache.setIdentityId(id, identityId)
      if (lid) this.cache.setIdentityId(lid, identityId)
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
        await this.identityRepository.updateIdentity(identityId, updateData)
      }
    }

    // 2. Ensure Aliases are created and pointing to the correct identity
    const ensureAlias = async (jid: string, type: string) => {
      await this.aliasRepository.upsertIdentityAlias(jid, type, identityId as number)
      this.cache.setIdentityId(jid, identityId as number)
    }

    const matchedStrategy = this.strategies.find(s => s.supports(id))
    if (matchedStrategy) {
      await ensureAlias(id, matchedStrategy.aliasType)
    }

    // If payload contains a LID, ensure that alias is created too
    if (lid) {
      await ensureAlias(lid, 'LID')
    }
  }

  async linkLidAndPn(lid: string, pn: string, source: string = 'unknown'): Promise<void> {
    return this.lidPnLinker.linkLidAndPn(
      lid,
      pn,
      source,
      (cleanLid, cleanPn) => this.cache.hasLink(`${cleanLid}->${cleanPn}`),
      (cleanLid, cleanPn, identityId) => {
        this.cache.setIdentityId(cleanLid, identityId)
        this.cache.setIdentityId(cleanPn, identityId)
        this.cache.addLink(`${cleanLid}->${cleanPn}`)
      }
    )
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
      if (this.cache.hasIdentityId(jid)) {
        result.set(jid, this.cache.getIdentityId(jid)!)
      } else {
        missing.push(jid)
      }
    }

    if (missing.length > 0) {
      const CHUNK = 500
      for (let i = 0; i < missing.length; i += CHUNK) {
        const chunk = missing.slice(i, i + CHUNK)
        const aliases = await this.aliasRepository.findIdentityAliasesMinimal(chunk)
        for (const alias of aliases) {
          result.set(alias.jid, alias.identityId)
          this.cache.setIdentityId(alias.jid, alias.identityId)
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
    if (this.cache.hasIdentityId(cleaned)) {
      return this.cache.getIdentityId(cleaned)!
    }

    const alias = await this.aliasRepository.findIdentityAlias(cleaned)
    if (alias) {
      this.cache.setIdentityId(cleaned, alias.identityId)
      return alias.identityId
    }

    // Fallback: search identity by phone number directly
    if (cleaned.endsWith('@s.whatsapp.net')) {
      const ident = await this.identityRepository.findIdentityByPhoneNumber(cleaned)
      if (ident) {
        this.cache.setIdentityId(cleaned, ident.id)
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
      const alias = await this.aliasRepository.findIdentityAlias(cleaned)

      if (alias) {
        // Find the LID alias for this identity
        const lidAlias = await this.aliasRepository.findLidAliasByIdentityId(alias.identityId)
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
    const existingJidAlias = await this.aliasRepository.findIdentityAlias(myJid)
    if (existingJidAlias) {
      identityId = existingJidAlias.identityId;
    }

    if (!identityId && myLid) {
      const existingLidAlias = await this.aliasRepository.findIdentityAlias(myLid)
      if (existingLidAlias) {
        identityId = existingLidAlias.identityId;
      }
    }

    // 2. Upsert the Identity row with isMe = true
    if (!identityId) {
      const newIdentity = await this.identityRepository.createIdentity({
        phoneNumber: myJid,
        displayName: name,
        isMe: true
      });
      identityId = newIdentity.id;
    } else {
      await this.identityRepository.updateIdentity(identityId, {
        phoneNumber: myJid,
        isMe: true
      });
    }

    // 3. Ensure aliases are pointing to the isMe identity
    await this.aliasRepository.upsertIdentityAlias(myJid, 'PN', identityId)

    if (myLid) {
      await this.aliasRepository.upsertIdentityAlias(myLid, 'LID', identityId)

      await this.lidMapRepository.upsertLidMap(myLid, myJid, 'registerMe').catch((err: unknown) => {
        console.error('[ContactService] Failed to upsert me lidMap entry:', err)
      });
    }

    this.cache.setMeJids(null);
  }

  /**
   * Find a single identity by ID.
   */
  public async findIdentityById(id: number): Promise<Identity | null> {
    return this.identityRepository.findIdentityById(id)
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
