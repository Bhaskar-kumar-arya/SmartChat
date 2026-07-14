import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import { PrismaClient } from '@prisma/client'
import { PrismaBetterSqlite3 } from '@prisma/adapter-better-sqlite3'
import { join } from 'path'
import { ChatMemberRepository } from '../../services/chats/ChatMemberRepository'

describe('ChatMemberRepository', () => {
  let prisma: PrismaClient
  let repository: ChatMemberRepository

  beforeAll(() => {
    const dbPath = join(__dirname, '../../../../prisma/test.db')
    const adapter = new (PrismaBetterSqlite3 as any)({ url: `file:${dbPath}` })
    prisma = new PrismaClient({ adapter })
    repository = new ChatMemberRepository(prisma)
  })

  afterAll(async () => {
    await prisma.$disconnect()
  })

  beforeEach(async () => {
    await prisma.chatMember.deleteMany()
    await prisma.chat.deleteMany()
    await prisma.identity.deleteMany()
  })

  it('should upsert chat member and auto-create chat if missing', async () => {
    const ident = await prisma.identity.create({ data: { phoneNumber: 'user@s.whatsapp.net' } })
    
    // chat doesn't exist yet, should auto-create
    await repository.upsertChatMember('group1@g.us', ident.id, 'MEMBER')

    const members = await repository.findChatMembers('group1@g.us')
    expect(members.length).toBe(1)
    expect(members[0].role).toBe('MEMBER')
    expect(members[0].identity.phoneNumber).toBe('user@s.whatsapp.net')

    const chat = await prisma.chat.findUnique({ where: { jid: 'group1@g.us' } })
    expect(chat).not.toBeNull()

    // update role
    await repository.upsertChatMember('group1@g.us', ident.id, 'ADMIN')
    const updatedMembers = await repository.findChatMembers('group1@g.us')
    expect(updatedMembers[0].role).toBe('ADMIN')
  })

  it('should not insert member if identity is missing', async () => {
    await prisma.chat.create({ data: { jid: 'group2@g.us', type: 'GROUP' } })
    
    // identity 999 doesn't exist
    const res = await repository.upsertChatMember('group2@g.us', 999, 'MEMBER')
    expect(res).toBeNull()

    const members = await repository.findChatMembers('group2@g.us')
    expect(members.length).toBe(0)
  })

  it('should delete chat member', async () => {
    const ident = await prisma.identity.create({ data: { phoneNumber: 'u2@s.whatsapp.net' } })
    await repository.upsertChatMember('group3@g.us', ident.id, 'MEMBER')
    
    let members = await repository.findChatMembers('group3@g.us')
    expect(members.length).toBe(1)

    await repository.deleteChatMember('group3@g.us', ident.id)
    members = await repository.findChatMembers('group3@g.us')
    expect(members.length).toBe(0)
  })
})
