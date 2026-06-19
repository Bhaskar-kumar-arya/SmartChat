import { Identity, IdentityAlias, LidMap } from '@prisma/client'

export interface IdentityCreateInput {
  phoneNumber?: string | null
  displayName?: string | null
  pushName?: string | null
  verifiedName?: string | null
  profilePictureUrl?: string | null
  isMe?: boolean
}

export interface IdentityUpdateInput {
  phoneNumber?: string | null
  displayName?: string | null
  pushName?: string | null
  verifiedName?: string | null
  profilePictureUrl?: string | null
  isMe?: boolean
}

export interface IdentityWithAliases extends Identity {
  aliases: IdentityAlias[]
}

export interface IdentityAliasWithIdentity extends IdentityAlias {
  identity: Identity | null
}

export interface IdentityAliasMinimal {
  jid: string
  identityId: number
}

export interface ReferenceCounts {
  aliases: number
  messages: number
  members: number
  reactions: number
}

export interface IContactRepository {
  findMeIdentity(): Promise<IdentityWithAliases | null>
  findIdentityByPhoneNumber(phoneNumber: string): Promise<Identity | null>
  findIdentityById(id: number): Promise<Identity | null>
  findIdentityAlias(jid: string): Promise<IdentityAlias | null>
  findLidAliasByIdentityId(identityId: number): Promise<IdentityAlias | null>
  findAllAliases(): Promise<IdentityAlias[]>
  findIdentityAliases(jids: string[]): Promise<IdentityAliasWithIdentity[]>
  findIdentityAliasesMinimal(jids: string[]): Promise<IdentityAliasMinimal[]>
  findLidMap(pn: string): Promise<LidMap | null>
  findLidMaps(lids: string[]): Promise<LidMap[]>
  createIdentity(data: IdentityCreateInput): Promise<Identity>
  updateIdentity(id: number, data: IdentityUpdateInput): Promise<Identity>
  upsertIdentityAlias(jid: string, type: string, identityId: number): Promise<IdentityAlias>
  upsertLidMap(lid: string, pn: string, source: string): Promise<LidMap>
  deleteIdentity(id: number): Promise<Identity>
  countIdentityReferences(id: number): Promise<ReferenceCounts>
  searchIdentities(query: string, take?: number): Promise<IdentityWithAliases[]>
}
