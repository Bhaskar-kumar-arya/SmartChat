import { PrismaClient } from '@prisma/client'

export class DataWipeService {
  constructor(private prisma: PrismaClient) {}

  async wipeAllData(): Promise<void> {
    // Delete in FK-safe order: children before parents
    await this.prisma.reaction.deleteMany()
    await this.prisma.messageVector.deleteMany()
    await this.prisma.message.deleteMany()
    await this.prisma.chatMember.deleteMany()
    await this.prisma.chat.deleteMany()
    await this.prisma.community.deleteMany()
    await this.prisma.identityAlias.deleteMany()
    await this.prisma.identity.deleteMany()
    await this.prisma.authState.deleteMany()
    console.log('[DataWipeService] All database tables cleared (including AuthState).')
  }

  async wipeUserDataOnly(): Promise<void> {
    // Clear user data but keep AuthState (credentials etc.)
    await this.prisma.reaction.deleteMany()
    await this.prisma.messageVector.deleteMany()
    await this.prisma.message.deleteMany()
    await this.prisma.chatMember.deleteMany()
    await this.prisma.chat.deleteMany()
    await this.prisma.community.deleteMany()
    await this.prisma.identityAlias.deleteMany()
    await this.prisma.identity.deleteMany()
    console.log('[DataWipeService] User data tables cleared (AuthState preserved).')
  }
}
