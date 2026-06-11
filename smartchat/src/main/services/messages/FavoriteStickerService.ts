import { PrismaClient } from '@prisma/client'
import { app } from 'electron'
import { join } from 'path'
import * as fs from 'fs'
import { unwrapMessage } from '../../utils'

export class FavoriteStickerService {
  constructor(private prisma: PrismaClient) {}

  private getMediaDir(): string {
    return join(app.getPath('userData'), 'media')
  }

  private getFavouritesDir(): string {
    const dir = join(app.getPath('userData'), 'favourites')
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true })
    }
    return dir
  }

  private getStickerFileName(stickerMsg: any, msgId: string): string {
    if (stickerMsg.localURI && stickerMsg.localURI.startsWith('app://media/')) {
      return stickerMsg.localURI.replace('app://media/', '')
    }
    let fileHash = 'unknown'
    if (stickerMsg.fileSha256) {
      const sha = stickerMsg.fileSha256
      if (typeof sha === 'string') {
        fileHash = sha.replace(/[/\\?%*:|"<>+]/g, '-').substring(0, 64)
      } else if (Buffer.isBuffer(sha)) {
        fileHash = sha.toString('hex')
      } else if (sha && typeof sha === 'object' && sha.type === 'Buffer' && Array.isArray(sha.data)) {
        fileHash = Buffer.from(sha.data).toString('hex')
      } else if (sha instanceof Uint8Array || Array.isArray(sha)) {
        fileHash = Buffer.from(sha).toString('hex')
      }
    } else {
      fileHash = msgId
    }
    return `hash_${fileHash}.webp`
  }

  private getShaString(stickerMsg: any): string {
    if (stickerMsg.fileSha256) {
      const sha = stickerMsg.fileSha256
      if (typeof sha === 'string') return sha
      if (Buffer.isBuffer(sha)) return sha.toString('base64')
      if (sha && typeof sha === 'object' && sha.type === 'Buffer' && Array.isArray(sha.data)) {
        return Buffer.from(sha.data).toString('base64')
      }
      if (sha instanceof Uint8Array || Array.isArray(sha)) {
        return Buffer.from(sha).toString('base64')
      }
    }
    return ''
  }

  async addStickerToFavorites(msgId: string): Promise<boolean> {
    const dbMsg = await this.prisma.message.findUnique({ where: { id: msgId } })
    if (!dbMsg || !dbMsg.content) throw new Error('Message not found')

    const rawMessage = JSON.parse(dbMsg.content)
    const unwrapped = unwrapMessage(rawMessage)
    const stickerMsg = unwrapped.stickerMessage
    if (!stickerMsg) throw new Error('Message is not a sticker')

    const fileSha256 = this.getShaString(stickerMsg)
    if (!fileSha256) throw new Error('Sticker has no SHA256 hash')

    const fileName = this.getStickerFileName(stickerMsg, msgId)
    const srcPath = join(this.getMediaDir(), fileName)

    if (!fs.existsSync(srcPath)) {
      throw new Error(`Sticker file not downloaded or cached yet: ${fileName}`)
    }

    const destPath = join(this.getFavouritesDir(), fileName)
    fs.copyFileSync(srcPath, destPath)

    await this.prisma.favoriteSticker.upsert({
      where: { fileSha256 },
      update: { createdAt: BigInt(Date.now()) },
      create: {
        fileSha256,
        fileName,
        createdAt: BigInt(Date.now())
      }
    })

    return true
  }

  async removeStickerFromFavorites(msgId: string): Promise<boolean> {
    const dbMsg = await this.prisma.message.findUnique({ where: { id: msgId } })
    if (!dbMsg || !dbMsg.content) throw new Error('Message not found')

    const rawMessage = JSON.parse(dbMsg.content)
    const unwrapped = unwrapMessage(rawMessage)
    const stickerMsg = unwrapped.stickerMessage
    if (!stickerMsg) throw new Error('Message is not a sticker')

    const fileSha256 = this.getShaString(stickerMsg)
    if (!fileSha256) return false

    return this.removeFavoriteStickerBySha(fileSha256)
  }

  async removeFavoriteStickerById(id: string): Promise<boolean> {
    const record = await this.prisma.favoriteSticker.findUnique({ where: { id } })
    if (!record) return false

    return this.removeFavoriteStickerBySha(record.fileSha256)
  }

  private async removeFavoriteStickerBySha(fileSha256: string): Promise<boolean> {
    const record = await this.prisma.favoriteSticker.findUnique({ where: { fileSha256 } })
    if (!record) return false

    await this.prisma.favoriteSticker.delete({ where: { fileSha256 } })

    // If no other favorite references the same file, delete the file on disk
    const count = await this.prisma.favoriteSticker.count({
      where: { fileName: record.fileName }
    })

    if (count === 0) {
      const filePath = join(this.getFavouritesDir(), record.fileName)
      if (fs.existsSync(filePath)) {
        try {
          fs.unlinkSync(filePath)
        } catch (e) {
          console.error('[FavoriteStickerService] Failed to delete file:', filePath, e)
        }
      }
    }

    return true
  }

  async isStickerFavorite(msgId: string): Promise<boolean> {
    const dbMsg = await this.prisma.message.findUnique({ where: { id: msgId } })
    if (!dbMsg || !dbMsg.content) return false

    const rawMessage = JSON.parse(dbMsg.content)
    const unwrapped = unwrapMessage(rawMessage)
    const stickerMsg = unwrapped.stickerMessage
    if (!stickerMsg) return false

    const fileSha256 = this.getShaString(stickerMsg)
    if (!fileSha256) return false

    const count = await this.prisma.favoriteSticker.count({ where: { fileSha256 } })
    return count > 0
  }

  async getFavoriteStickers(): Promise<any[]> {
    const favs = await this.prisma.favoriteSticker.findMany({
      orderBy: { createdAt: 'desc' }
    })

    return favs.map(f => ({
      id: f.id,
      fileSha256: f.fileSha256,
      fileName: f.fileName,
      localURI: `app://favourites/${f.fileName}`,
      createdAt: Number(f.createdAt)
    }))
  }
}
