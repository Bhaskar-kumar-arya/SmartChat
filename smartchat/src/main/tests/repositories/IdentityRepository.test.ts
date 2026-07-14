import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import { PrismaClient } from '@prisma/client'
import { PrismaBetterSqlite3 } from '@prisma/adapter-better-sqlite3'
import { join } from 'path'
import { IdentityRepository } from '../../services/contacts/IdentityRepository'

describe('IdentityRepository', () => {
  let prisma: PrismaClient
  let repository: IdentityRepository

  beforeAll(() => {
    const dbPath = join(__dirname, '../../../../prisma/test.db')
    const adapter = new (PrismaBetterSqlite3 as any)({
      url: `file:${dbPath}`
    })
    prisma = new PrismaClient({ adapter })
    repository = new IdentityRepository(prisma)
  })

  afterAll(async () => {
    await prisma.$disconnect()
  })

  beforeEach(async () => {
    // Wipe dependencies first
    await prisma.reaction.deleteMany()
    await prisma.message.deleteMany()
    await prisma.chatMember.deleteMany()
    await prisma.identityAlias.deleteMany()
    await prisma.chat.deleteMany()
    await prisma.identity.deleteMany()
  })

  it('should create and find an identity by id or phone number', async () => {
    const created = await repository.createIdentity({
      phoneNumber: '111222333@s.whatsapp.net',
      displayName: 'Alice',
      pushName: 'Alice Push',
      isMe: false
    })

    expect(created.id).toBeDefined()
    expect(created.displayName).toBe('Alice')

    const byId = await repository.findIdentityById(created.id)
    expect(byId).not.toBeNull()
    expect(byId?.phoneNumber).toBe('111222333@s.whatsapp.net')

    const byPhone = await repository.findIdentityByPhoneNumber('111222333@s.whatsapp.net')
    expect(byPhone).not.toBeNull()
    expect(byPhone?.id).toBe(created.id)
  })

  it('should find the "me" identity and include aliases', async () => {
    const me = await repository.createIdentity({
      phoneNumber: 'me@s.whatsapp.net',
      isMe: true
    })

    await prisma.identityAlias.create({
      data: { jid: 'me@s.whatsapp.net', type: 'PN', identityId: me.id }
    })
    await prisma.identityAlias.create({
      data: { jid: 'my-lid@lid', type: 'LID', identityId: me.id }
    })

    const foundMe = await repository.findMeIdentity()
    expect(foundMe).not.toBeNull()
    expect(foundMe?.id).toBe(me.id)
    expect(foundMe?.aliases.length).toBe(2)
  })

  it('should update and delete an identity', async () => {
    const identity = await repository.createIdentity({
      phoneNumber: 'temp@s.whatsapp.net',
      displayName: 'Temp'
    })

    await repository.updateIdentity(identity.id, { displayName: 'Updated Temp' })
    let fetched = await repository.findIdentityById(identity.id)
    expect(fetched?.displayName).toBe('Updated Temp')

    await repository.deleteIdentity(identity.id)
    fetched = await repository.findIdentityById(identity.id)
    expect(fetched).toBeNull()
  })

  it('should accurately count references for an identity', async () => {
    const ident = await repository.createIdentity({ phoneNumber: 'target@s.whatsapp.net' })
    await prisma.chat.create({ data: { jid: 'chat@g.us', type: 'GROUP' } })

    // Add 2 aliases
    await prisma.identityAlias.create({ data: { jid: 'target@s.whatsapp.net', type: 'PN', identityId: ident.id } })
    await prisma.identityAlias.create({ data: { jid: 'target-lid@lid', type: 'LID', identityId: ident.id } })

    // Add 3 messages
    await prisma.message.create({ data: { id: 'm1', chatJid: 'chat@g.us', senderId: ident.id, fromMe: false, timestamp: 1n, messageType: 'conversation', content: '{}' } })
    await prisma.message.create({ data: { id: 'm2', chatJid: 'chat@g.us', senderId: ident.id, fromMe: false, timestamp: 2n, messageType: 'conversation', content: '{}' } })
    await prisma.message.create({ data: { id: 'm3', chatJid: 'chat@g.us', senderId: ident.id, fromMe: false, timestamp: 3n, messageType: 'conversation', content: '{}' } })

    // Add 1 chat member
    await prisma.chatMember.create({ data: { chatJid: 'chat@g.us', identityId: ident.id } })

    // Add 2 reactions
    await prisma.reaction.create({ data: { messageId: 'm1', senderId: ident.id, text: '👍', timestamp: 4n } })
    await prisma.reaction.create({ data: { messageId: 'm2', senderId: ident.id, text: '❤️', timestamp: 5n } })

    const counts = await repository.countIdentityReferences(ident.id)
    expect(counts).toEqual({
      aliases: 2,
      messages: 3,
      members: 1,
      reactions: 2
    })
  })

  it('should search identities based on query', async () => {
    await repository.createIdentity({ displayName: 'Charlie Brown', phoneNumber: '123' })
    await repository.createIdentity({ pushName: 'Charlotte', phoneNumber: '456' })
    await repository.createIdentity({ verifiedName: 'Charity Org', phoneNumber: '789' })
    await repository.createIdentity({ displayName: 'David', phoneNumber: 'char' })
    await repository.createIdentity({ displayName: 'Eve', phoneNumber: '999' })

    const results = await repository.searchIdentities('char')
    expect(results.length).toBe(4) // Charlie, Charlotte, Charity, David
    const phoneMatches = results.filter(r => r.displayName === 'David')
    expect(phoneMatches.length).toBe(1)
  })
})
