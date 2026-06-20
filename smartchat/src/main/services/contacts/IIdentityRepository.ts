import { Identity, IdentityAlias } from '../../domain/types'

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

export interface ReferenceCounts {
  aliases: number
  messages: number
  members: number
  reactions: number
}

export interface IIdentityQueryRepository {
  findMeIdentity(): Promise<IdentityWithAliases | null>
  findIdentityByPhoneNumber(phoneNumber: string): Promise<Identity | null>
  findIdentityById(id: number): Promise<Identity | null>
  countIdentityReferences(id: number): Promise<ReferenceCounts>
  searchIdentities(query: string, take?: number): Promise<IdentityWithAliases[]>
}

export interface IIdentityWriteRepository {
  createIdentity(data: IdentityCreateInput): Promise<Identity>
  updateIdentity(id: number, data: IdentityUpdateInput): Promise<Identity>
  deleteIdentity(id: number): Promise<Identity>
}

export interface IIdentityRepository extends IIdentityQueryRepository, IIdentityWriteRepository {}
