import { Identity, IdentityAlias } from '../../domain/types'

export interface IdentityAliasWithIdentity extends IdentityAlias {
  identity: Identity | null
}

export interface IdentityAliasMinimal {
  jid: string
  identityId: number
}

export interface IAliasQueryRepository {
  findIdentityAlias(jid: string): Promise<IdentityAlias | null>
  findLidAliasByIdentityId(identityId: number): Promise<IdentityAlias | null>
  findAllAliases(): Promise<IdentityAlias[]>
  findIdentityAliases(jids: string[]): Promise<IdentityAliasWithIdentity[]>
  findIdentityAliasesMinimal(jids: string[]): Promise<IdentityAliasMinimal[]>
}

export interface IAliasWriteRepository {
  upsertIdentityAlias(jid: string, type: string, identityId: number): Promise<IdentityAlias>
}

export interface IAliasRepository extends IAliasQueryRepository, IAliasWriteRepository {}
