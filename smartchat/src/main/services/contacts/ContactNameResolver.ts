import { cleanJid } from '../../utils/jidUtils'
import { IAliasRepository } from './IAliasRepository'
import { IContactNameResolver, ISocketUserContext } from './IContactService'

function hasSignalRepository(
  sock: ISocketUserContext | null | undefined
): sock is ISocketUserContext & Required<Pick<ISocketUserContext, 'signalRepository'>> {
  return !!sock && typeof sock === 'object' && 'signalRepository' in sock
}

export class ContactNameResolver implements IContactNameResolver {
  constructor(
    private readonly repository: IAliasRepository,
    private readonly getMeJids: (sock?: ISocketUserContext | null) => Promise<string[]>,
    private readonly linkLidAndPn: (lid: string, pn: string, source: string) => Promise<void>
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

  /**
   * Resolves a collection of JIDs into a map of display names.
   * Efficiently handles the N+1 problem by batching DB requests.
   */
  async batchResolveNames(
    jids: string[],
    sock?: ISocketUserContext | null
  ): Promise<Map<string, string>> {
    const meJids = await this.getMeJids(sock)
    const uniqueJids = Array.from(new Set(jids.filter(Boolean).map(cleanJid)))
    if (uniqueJids.length === 0) return new Map()

    const aliases: Array<{
      jid: string
      identityId: number
      identity: {
        id: number
        phoneNumber: string | null
        displayName: string | null
        pushName: string | null
        verifiedName: string | null
        isMe: boolean
      } | null
    }> = []
    
    const BATCH_SIZE = 250
    for (let i = 0; i < uniqueJids.length; i += BATCH_SIZE) {
      const chunk = uniqueJids.slice(i, i + BATCH_SIZE)
      const res = await this.repository.findIdentityAliases(chunk)
      if (res) {
        aliases.push(...res)
      }
    }

    const nameMap = new Map<string, string>()

    for (const jid of uniqueJids) {
      // 1. Is it "Me"?
      if (meJids.includes(jid)) {
        nameMap.set(jid, sock?.user?.name || 'Me')
        continue
      }

      // 2. Find matching alias
      const alias = aliases.find(a => a.jid === jid)
      
      if (alias && alias.identity) {
        const ident = alias.identity
        const finalName = ContactNameResolver.getDisplayName(ident, jid.split('@')[0])
        nameMap.set(jid, finalName)
      } else {
        // Tier 3: Runtime Cache Query
        let resolvedFromCache = false;
        if (jid.includes('@lid') && hasSignalRepository(sock) && sock.signalRepository?.lidMapping?.getPNForLID) {
          const pnRaw = await sock.signalRepository.lidMapping.getPNForLID(jid);
          const pn = cleanJid(pnRaw);
          if (pn) {
            resolvedFromCache = true;
            // Async fire-and-forget to link them
            this.linkLidAndPn(jid, pn, 'runtime.cache').catch((err: unknown) => {
              console.error('[ContactNameResolver] Failed to link LID and PN in runtime cache:', err)
            });
            
            // Re-check aliases just in case PN is known
            const pnAlias = aliases.find(a => a.jid === pn);
            if (pnAlias && pnAlias.identity) {
              const ident = pnAlias.identity;
              const finalName = ContactNameResolver.getDisplayName(ident, pn.split('@')[0])
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
  async resolveName(
    jid: string,
    chatName: string | null,
    sock?: ISocketUserContext | null
  ): Promise<string> {
    const cleaned = cleanJid(jid)
    const map = await this.batchResolveNames([cleaned], sock)
    const resolved = map.get(cleaned)
    // If it's just the raw number (fallback), and we have a chatName, use the chatName
    if (resolved === cleaned.split('@')[0] && chatName) {
      return chatName
    }
    return resolved || chatName || cleaned.split('@')[0]
  }
}

