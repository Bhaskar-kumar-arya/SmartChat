import { PrismaClient } from '@prisma/client'
import { app } from 'electron'
import { join } from 'path'
import * as fs from 'fs'
import { unwrapMessage } from '../../utils'
import { downloadContentFromMessage } from '@whiskeysockets/baileys'

import { IFavoriteStickerService, FavoriteStickerDTO } from './IFavoriteStickerService'

async function streamToBuffer(stream: AsyncIterable<Buffer>): Promise<Buffer> {
  const chunks: Buffer[] = []
  for await (const chunk of stream) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))
  }
  return Buffer.concat(chunks)
}

interface StickerMessageLike {
  localURI?: string | null;
  fileSha256?: unknown;
  mediaKey?: unknown;
}

export class FavoriteStickerService implements IFavoriteStickerService {
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

  private getStickerFileName(stickerMsg: StickerMessageLike, msgId?: string): string {
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
      } else if (sha && typeof sha === 'object') {
        const shaObj = sha as Record<string, unknown>
        if (shaObj.type === 'Buffer' && Array.isArray(shaObj.data)) {
          fileHash = Buffer.from(shaObj.data as number[]).toString('hex')
        } else if (sha instanceof Uint8Array) {
          fileHash = Buffer.from(sha).toString('hex')
        }
      } else if (Array.isArray(sha)) {
        fileHash = Buffer.from(sha).toString('hex')
      }
    } else if (msgId) {
      fileHash = msgId
    }
    return `hash_${fileHash}.webp`
  }

  private getShaString(stickerMsg: StickerMessageLike): string {
    if (stickerMsg.fileSha256) {
      const sha = stickerMsg.fileSha256
      if (typeof sha === 'string') return sha
      if (Buffer.isBuffer(sha)) return sha.toString('base64')
      if (sha && typeof sha === 'object') {
        const shaObj = sha as Record<string, unknown>
        if (shaObj.type === 'Buffer' && Array.isArray(shaObj.data)) {
          return Buffer.from(shaObj.data as number[]).toString('base64')
        } else if (sha instanceof Uint8Array) {
          return Buffer.from(sha).toString('base64')
        }
      }
      if (Array.isArray(sha)) {
        return Buffer.from(sha).toString('base64')
      }
    }
    return ''
  }

  async addStickerToFavorites(msgId: string): Promise<boolean> {
    const dbMsg = await this.prisma.message.findUnique({ where: { id: msgId } })
    if (!dbMsg || !dbMsg.content) throw new Error('Message not found')

    const rawMessage = JSON.parse(dbMsg.content) as Record<string, unknown>
    const unwrapped = unwrapMessage(rawMessage) as Record<string, unknown>
    const stickerMsg = unwrapped.stickerMessage as StickerMessageLike | undefined
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

    const rawMessage = JSON.parse(dbMsg.content) as Record<string, unknown>
    const unwrapped = unwrapMessage(rawMessage) as Record<string, unknown>
    const stickerMsg = unwrapped.stickerMessage as StickerMessageLike | undefined
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

  public async removeFavoriteStickerBySha(fileSha256: string): Promise<boolean> {
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
        } catch (e: unknown) {
          console.error('[FavoriteStickerService] Failed to delete file:', filePath, e)
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

    const fileSha256 = this.getShaString(stickerMsg)
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

  private ensureBuffer(val: unknown): Buffer | null {
    if (!val) return null
    if (Buffer.isBuffer(val)) return val
    if (val instanceof Uint8Array) return Buffer.from(val.buffer, val.byteOffset, val.byteLength)
    if (typeof val === 'string') {
      if (/^[0-9a-fA-F]+$/.test(val) && val.length % 2 === 0) {
        return Buffer.from(val, 'hex')
      }
      return Buffer.from(val, 'base64')
    }
    if (typeof val === 'object') {
      const obj = val as Record<string, unknown>
      if (obj.type === 'Buffer' && Array.isArray(obj.data)) {
        return Buffer.from(obj.data as number[])
      }
      if (Array.isArray(val)) {
        return Buffer.from(val)
      }
    }
    return null
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
          stickerAction.mediaKey = this.ensureBuffer(stickerAction.mediaKey)
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
        console.warn(`[FavoriteStickerService] Failed to download synced sticker for SHA ${fileSha256}: HTTP ${statusCode}`)
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
          console.log(`[FavoriteStickerService] Auto-copied synced favorite sticker: ${favRecord.fileName}`)
        }
      }
    } catch (err) {
      console.error('[FavoriteStickerService] Failed during auto-copy of favorite sticker:', err)
    }
  }

  /**
   * Batch-find favorite sticker records matching the given SHA-256 hashes.
   * Used by MediaService to check if downloaded stickers should be auto-cached to favourites.
   */
  async findFavoritesByHashes(hashes: string[]): Promise<Array<{ fileSha256: string; fileName: string }>> {
    if (hashes.length === 0) return []
    return this.prisma.favoriteSticker.findMany({
      where: { fileSha256: { in: hashes } },
      select: { fileSha256: true, fileName: true }
    })
  }
}
