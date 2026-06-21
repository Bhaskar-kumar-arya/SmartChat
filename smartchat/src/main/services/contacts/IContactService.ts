import { Identity } from '../../domain/entities'

export interface ISocketUserContext {
  user?: {
    id: string
    name?: string | null
    lid?: string | null
  } | null
  signalRepository?: {
    lidMapping?: {
      getPNForLID?: (lid: string) => Promise<string | null | undefined>
    }
  }
  profilePictureUrl?: (jid: string, type: 'preview' | 'image') => Promise<string | undefined>
}

export interface IContactQueryService {
  getMeJids(sock?: ISocketUserContext | null): Promise<string[]>
  batchGetIdentityIds(jids: string[]): Promise<Map<string, number>>
  getIdentityIdByJid(jid: string | { id: string } | null | undefined): Promise<number | null>
  resolveLidFromJid(jid: string): Promise<string>
  findIdentityById(id: number): Promise<Identity | null>
  getMePhoneNumberJid(sock?: ISocketUserContext | null): Promise<string | null>
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
  batchResolveNames(jids: string[], sock?: ISocketUserContext | null): Promise<Map<string, string>>
  resolveName(jid: string, chatName: string | null, sock?: ISocketUserContext | null): Promise<string>
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

