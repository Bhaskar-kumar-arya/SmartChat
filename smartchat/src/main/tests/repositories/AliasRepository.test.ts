import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import { PrismaClient } from '@prisma/client'
import { PrismaBetterSqlite3 } from '@prisma/adapter-better-sqlite3'
import { join } from 'path'
import { AliasRepository } from '../../services/contacts/AliasRepository'

describe('AliasRepository', () => {
  let prisma: PrismaClient
  let repository: AliasRepository

  beforeAll(() => {
    const dbPath = join(__dirname, '../../../../prisma/test.db')
    const adapter = new (PrismaBetterSqlite3 as any)({ url: `file:${dbPath}` })
    prisma = new PrismaClient({ adapter })
    repository = new AliasRepository(prisma)
  })

  afterAll(async () => {
    await prisma.$disconnect()
  })

  beforeEach(async () => {
    await prisma.reaction.deleteMany()
    await prisma.message.deleteMany()
    await prisma.chatMember.deleteMany()
    await prisma.identityAlias.deleteMany()
    await prisma.chat.deleteMany()
    await prisma.identity.deleteMany()
  })

  it('should upsert and find an alias', async () => {
    const ident = await prisma.identity.create({ data: { phoneNumber: 'foo@s.whatsapp.net' } })
    
    // upsert first time (create)
    const created = await repository.upsertIdentityAlias('my-alias@lid', 'LID', ident.id)
    expect(created.jid).toBe('my-alias@lid')
    expect(created.type).toBe('LID')
    expect(created.identityId).toBe(ident.id)
    
    // upsert second time (update)
    const ident2 = await prisma.identity.create({ data: { phoneNumber: 'bar@s.whatsapp.net' } })
    const updated = await repository.upsertIdentityAlias('my-alias@lid', 'PN', ident2.id)
    expect(updated.type).toBe('PN')
    expect(updated.identityId).toBe(ident2.id)
    
    // find
    const found = await repository.findIdentityAlias('my-alias@lid')
    expect(found?.identityId).toBe(ident2.id)
  })

  it('should find LID alias by identity ID', async () => {
    const ident = await prisma.identity.create({ data: { phoneNumber: 'baz@s.whatsapp.net' } })
    await repository.upsertIdentityAlias('baz@s.whatsapp.net', 'PN', ident.id)
    await repository.upsertIdentityAlias('baz-lid@lid', 'LID', ident.id)

    const found = await repository.findLidAliasByIdentityId(ident.id)
    expect(found?.jid).toBe('baz-lid@lid')
    expect(found?.type).toBe('LID')
  })

  it('should find identity aliases (with identity join) for given JIDs', async () => {
    const ident1 = await prisma.identity.create({ data: { phoneNumber: 'a@s.whatsapp.net', displayName: 'A' } })
    const ident2 = await prisma.identity.create({ data: { phoneNumber: 'b@s.whatsapp.net', displayName: 'B' } })
    
    await repository.upsertIdentityAlias('a-lid@lid', 'LID', ident1.id)
    await repository.upsertIdentityAlias('b-lid@lid', 'LID', ident2.id)

    const aliases = await repository.findIdentityAliases(['a-lid@lid', 'b-lid@lid', 'unknown@lid'])
    expect(aliases.length).toBe(2)
    const a = aliases.find(a => a.jid === 'a-lid@lid')
    expect(a?.identity?.displayName).toBe('A')

    // test empty array
    const empty = await repository.findIdentityAliases([])
    expect(empty.length).toBe(0)
  })

  it('should find minimal identity aliases for given JIDs', async () => {
    const ident1 = await prisma.identity.create({ data: { phoneNumber: 'a@s.whatsapp.net' } })
    await repository.upsertIdentityAlias('a-lid@lid', 'LID', ident1.id)

    const aliases = await repository.findIdentityAliasesMinimal(['a-lid@lid'])
    expect(aliases.length).toBe(1)
    expect(aliases[0].jid).toBe('a-lid@lid')
    expect(aliases[0].identityId).toBe(ident1.id)
    expect((aliases[0] as any).identity).toBeUndefined() // minimal doesn't join identity
  })

  it('should find all aliases', async () => {
    const ident1 = await prisma.identity.create({ data: { phoneNumber: 'a@s.whatsapp.net' } })
    await repository.upsertIdentityAlias('a-lid@lid', 'LID', ident1.id)
    await repository.upsertIdentityAlias('a@s.whatsapp.net', 'PN', ident1.id)

    const all = await repository.findAllAliases()
    expect(all.length).toBe(2)
  })
})
