import { Identity } from '@prisma/client'
import { WASocket } from '../whatsapp/types'

export interface IContactService {
  clearCaches(): void
  getMeJids(sock?: WASocket | null): Promise<string[]>
  warmLinkCache(cacheKey: string): void
  populateIdentityIdCache(entries: Map<string, number>): void
  batchResolveNames(jids: string[], sock?: WASocket | null): Promise<Map<string, string>>
  resolveName(jid: string, chatName: string | null, sock?: WASocket | null): Promise<string>
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
  batchGetIdentityIds(jids: string[]): Promise<Map<string, number>>
  getIdentityIdByJid(jid: string | { id: string } | null | undefined): Promise<number | null>
  resolveLidFromJid(jid: string): Promise<string>
  registerMe(user: { id: string; name?: string; lid?: string }): Promise<void>
  findIdentityById(id: number): Promise<Identity | null>
  getMePhoneNumberJid(sock?: WASocket | null): Promise<string | null>
}
