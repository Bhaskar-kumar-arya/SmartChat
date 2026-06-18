import { Identity, IdentityAlias, LidMap } from '@prisma/client'
import {
  IdentityCreateInput,
  IdentityUpdateInput,
  IdentityWithAliases,
  IdentityAliasWithIdentity,
  IdentityAliasMinimal,
  ReferenceCounts
} from './ContactRepository'

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
