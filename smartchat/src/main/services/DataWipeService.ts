import { PrismaClient } from '@prisma/client'
import { IDataWipeService } from './IDataWipeService'

export class DataWipeService implements IDataWipeService {
  constructor(private prisma: PrismaClient) {}

  private wipeFavouritesFolder(): void {
    try {
      const { app } = require('electron')
      const fs = require('fs')
      const path = require('path')
      const favsDir = path.join(app.getPath('userData'), 'favourites')
      if (fs.existsSync(favsDir)) {
        const files = fs.readdirSync(favsDir)
        for (const file of files) {
          try {
            fs.unlinkSync(path.join(favsDir, file))
          } catch (err) {
            console.error('[DataWipeService] Failed to unlink favourite file:', err)
          }
        }
      }
    } catch (e) {
      console.error('[DataWipeService] Failed to clear favourites folder:', e)
    }
  }

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
    await this.prisma.favoriteSticker.deleteMany().catch((err) => {
      console.error('[DataWipeService] Failed to wipe favoriteSticker:', err)
    })
    this.wipeFavouritesFolder()
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
    await this.prisma.favoriteSticker.deleteMany().catch((err) => {
      console.error('[DataWipeService] Failed to wipe user favoriteSticker:', err)
    })
    this.wipeFavouritesFolder()
    console.log('[DataWipeService] User data tables cleared (AuthState preserved).')
  }
}

