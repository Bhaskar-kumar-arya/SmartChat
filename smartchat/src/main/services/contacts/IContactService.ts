import { Identity } from '../../domain/types'
import { WASocket } from '../whatsapp/types'

export function getDisplayName(
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

export interface IContactQueryService {
  getMeJids(sock?: WASocket | null): Promise<string[]>
  batchGetIdentityIds(jids: string[]): Promise<Map<string, number>>
  getIdentityIdByJid(jid: string | { id: string } | null | undefined): Promise<number | null>
  resolveLidFromJid(jid: string): Promise<string>
  findIdentityById(id: number): Promise<Identity | null>
  getMePhoneNumberJid(sock?: WASocket | null): Promise<string | null>
}

export interface IContactMutationService {
  upsertContact(
    contact: {
      id: string
      lid?: string | null
      phoneNumber?: string | null
      name?: string | null
      notify?: string | null
      pushName?: string | null
      verifiedName?: string | null
    },
    options?: { overwriteName?: boolean }
  ): Promise<void>
  linkLidAndPn(lid: string, pn: string, source?: string): Promise<void>
  registerMe(user: { id: string; name?: string; lid?: string }): Promise<void>
}

export interface IContactNameResolver {
  batchResolveNames(jids: string[], sock?: WASocket | null): Promise<Map<string, string>>
  resolveName(jid: string, chatName: string | null, sock?: WASocket | null): Promise<string>
}

export interface IContactCacheManager {
  clearCaches(): void
  warmLinkCache(cacheKey: string): void
  populateIdentityIdCache(entries: Map<string, number>): void
}

export interface IContactService
  extends IContactQueryService,
    IContactMutationService,
    IContactNameResolver,
    IContactCacheManager {}
