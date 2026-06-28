import { PrismaClient } from '@prisma/client'
import * as fs from 'fs'
import { join } from 'path'
import { downloadContentFromMessage } from '@whiskeysockets/baileys'
import { unwrapMessage } from '../../../utils/messageUtils'
import { IFavoriteStickerService, FavoriteStickerDTO } from '../../../services/messages/IFavoriteStickerService'
import { ensureBuffer, streamToBuffer, extractStickerSha } from '../utils/workerUtils'

export interface StickerMessageLike {
  localURI?: string | null
  fileSha256?: unknown
  mediaKey?: unknown
}

export class WorkerFavoriteStickerService implements IFavoriteStickerService {
  constructor(private prisma: PrismaClient, private readonly userDataPath: string) {}

  private getMediaDir(): string {
    return join(this.userDataPath, 'media')
  }

  private getFavouritesDir(): string {
    const dir = join(this.userDataPath, 'favourites')
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true })
    }
    return dir
  }

  private getStickerFileName(stickerMsg: StickerMessageLike, msgId?: string): string {
    if (stickerMsg.localURI && stickerMsg.localURI.startsWith('app://media/')) {
      return stickerMsg.localURI.replace('app://media/', '')
    }
    let fileHash = 'unknown'
    const sha = extractStickerSha(stickerMsg)
    if (sha) {
      fileHash = sha.replace(/[/\\?%*:|"<>+]/g, '-').substring(0, 64)
    } else if (msgId) {
      fileHash = msgId
    }
    return `hash_${fileHash}.webp`
  }

  async addStickerToFavorites(msgId: string): Promise<boolean> {
    const dbMsg = await this.prisma.message.findUnique({ where: { id: msgId } })
    if (!dbMsg || !dbMsg.content) throw new Error('Message not found')

    const rawMessage = JSON.parse(dbMsg.content) as Record<string, unknown>
    const unwrapped = unwrapMessage(rawMessage) as Record<string, unknown>
    const stickerMsg = unwrapped.stickerMessage as StickerMessageLike | undefined
    if (!stickerMsg) throw new Error('Message is not a sticker')

    const fileSha256 = extractStickerSha(stickerMsg)
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

    const rawMessage = JSON.parse(dbMsg.content) as Record<string, unknown>
    const unwrapped = unwrapMessage(rawMessage) as Record<string, unknown>
    const stickerMsg = unwrapped.stickerMessage as StickerMessageLike | undefined
    if (!stickerMsg) throw new Error('Message is not a sticker')

    const fileSha256 = extractStickerSha(stickerMsg)
    if (!fileSha256) return false

    return this.removeFavoriteStickerBySha(fileSha256)
  }

  async removeFavoriteStickerById(id: string): Promise<boolean> {
    const record = await this.prisma.favoriteSticker.findUnique({ where: { id } })
    if (!record) return false

    return this.removeFavoriteStickerBySha(record.fileSha256)
  }

  public async removeFavoriteStickerBySha(fileSha256: string): Promise<boolean> {
    const record = await this.prisma.favoriteSticker.findUnique({ where: { fileSha256 } })
    if (!record) return false

    await this.prisma.favoriteSticker.delete({ where: { fileSha256 } })

    const count = await this.prisma.favoriteSticker.count({
      where: { fileName: record.fileName }
    })

    if (count === 0) {
      const filePath = join(this.getFavouritesDir(), record.fileName)
      if (fs.existsSync(filePath)) {
        try {
          fs.unlinkSync(filePath)
        } catch (e: unknown) {
          console.error('[WorkerFavoriteStickerService] Failed to delete file:', filePath, e)
        }
      }
    }

    return true
  }

  async isStickerFavorite(msgId: string): Promise<boolean> {
    const dbMsg = await this.prisma.message.findUnique({ where: { id: msgId } })
    if (!dbMsg || !dbMsg.content) return false

    const rawMessage = JSON.parse(dbMsg.content) as Record<string, unknown>
    const unwrapped = unwrapMessage(rawMessage) as Record<string, unknown>
    const stickerMsg = unwrapped.stickerMessage as StickerMessageLike | undefined
    if (!stickerMsg) return false

    const fileSha256 = extractStickerSha(stickerMsg)
    if (!fileSha256) return false

    const count = await this.prisma.favoriteSticker.count({ where: { fileSha256 } })
    return count > 0
  }

  async getFavoriteStickers(): Promise<FavoriteStickerDTO[]> {
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

  async syncFavoriteSticker(
    fileSha256: string,
    stickerAction: Record<string, unknown> & { mediaKey?: unknown; fileSha256?: unknown },
    sock: unknown
  ): Promise<boolean> {
    if (!stickerAction) return false

    const tempStickerMsg = { ...stickerAction, fileSha256 }
    const fileName = this.getStickerFileName(tempStickerMsg)
    const destPath = join(this.getFavouritesDir(), fileName)

    let downloadSuccess = false

    if (fs.existsSync(destPath)) {
      downloadSuccess = true
    } else if (sock) {
      try {
        if (stickerAction.mediaKey) {
          stickerAction.mediaKey = ensureBuffer(stickerAction.mediaKey)
        }
        const stream = await downloadContentFromMessage(stickerAction as Parameters<typeof downloadContentFromMessage>[0], 'sticker')
        const buffer = await streamToBuffer(stream)
        if (buffer.length > 0) {
          fs.writeFileSync(destPath, buffer)
          downloadSuccess = true
        }
      } catch (err: unknown) {
        const errorObj = err as Record<string, unknown>
        const outputObj = errorObj?.output as Record<string, unknown> | undefined
        const statusCode = outputObj?.statusCode ?? errorObj?.statusCode ?? 'unknown'
        console.warn(`[WorkerFavoriteStickerService] Failed to download synced sticker for SHA ${fileSha256}: HTTP ${statusCode}`)
      }
    }

    await this.prisma.favoriteSticker.upsert({
      where: { fileSha256 },
      update: {},
      create: {
        fileSha256,
        fileName,
        createdAt: BigInt(Date.now())
      }
    })

    return downloadSuccess
  }

  async handleDownloadedSticker(fileSha256: string, sourcePath: string): Promise<void> {
    try {
      const favRecord = await this.prisma.favoriteSticker.findUnique({
        where: { fileSha256 }
      })
      if (favRecord) {
        const favouritesDir = this.getFavouritesDir()
        const favFilePath = join(favouritesDir, favRecord.fileName)
        if (!fs.existsSync(favFilePath) && fs.existsSync(sourcePath)) {
          fs.copyFileSync(sourcePath, favFilePath)
          console.log(`[WorkerFavoriteStickerService] Auto-copied synced favorite sticker: ${favRecord.fileName}`)
        }
      }
    } catch (err) {
      console.error('[WorkerFavoriteStickerService] Failed during auto-copy of favorite sticker:', err)
    }
  }

  async findFavoritesByHashes(hashes: string[]): Promise<Array<{ fileSha256: string; fileName: string }>> {
    if (hashes.length === 0) return []
    return this.prisma.favoriteSticker.findMany({
      where: { fileSha256: { in: hashes } },
      select: { fileSha256: true, fileName: true }
    })
  }
}
