import { Identity, IdentityAlias } from '@prisma/client'

export interface IdentityAliasWithIdentity extends IdentityAlias {
  identity: Identity | null
}

export interface IdentityAliasMinimal {
  jid: string
  identityId: number
}

export interface IAliasRepository {
  findIdentityAlias(jid: string): Promise<IdentityAlias | null>
  findLidAliasByIdentityId(identityId: number): Promise<IdentityAlias | null>
  findAllAliases(): Promise<IdentityAlias[]>
  findIdentityAliases(jids: string[]): Promise<IdentityAliasWithIdentity[]>
  findIdentityAliasesMinimal(jids: string[]): Promise<IdentityAliasMinimal[]>
  upsertIdentityAlias(jid: string, type: string, identityId: number): Promise<IdentityAlias>
}
