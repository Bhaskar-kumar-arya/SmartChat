import { Identity, IdentityAlias } from '@prisma/client'

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

export interface IIdentityRepository {
  findMeIdentity(): Promise<IdentityWithAliases | null>
  findIdentityByPhoneNumber(phoneNumber: string): Promise<Identity | null>
  findIdentityById(id: number): Promise<Identity | null>
  createIdentity(data: IdentityCreateInput): Promise<Identity>
  updateIdentity(id: number, data: IdentityUpdateInput): Promise<Identity>
  deleteIdentity(id: number): Promise<Identity>
  countIdentityReferences(id: number): Promise<ReferenceCounts>
  searchIdentities(query: string, take?: number): Promise<IdentityWithAliases[]>
}
