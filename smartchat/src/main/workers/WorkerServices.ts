import { PrismaClient, Message } from '@prisma/client'
import * as fs from 'fs'
import { join } from 'path'
import { downloadContentFromMessage } from '@whiskeysockets/baileys'
import { unwrapMessage } from '../utils/messageUtils'
import { IFavoriteStickerService, FavoriteStickerDTO } from '../services/messages/IFavoriteStickerService'
import { IMediaService, IMediaSocket } from '../services/messages/IMediaService'
import { IMessageCompoundRepository } from '../services/messages/IMessageCompoundRepository'
import { IMessageReadRepository } from '../services/messages/IMessageQueryRepository'
import { IMessageQueryService } from '../services/messages/IMessageQueryService'
import { IMessageParserService } from '../services/messages/IMessageParserService'
import { IContactNameResolver, IContactQueryService, IContactMutationService, IContactCacheManager } from '../services/contacts/IContactService'
import { EnrichedMessage } from '../ipc/message.types'
import { BaileysWebMessageInfo } from '../services/whatsapp/types'
import { IHistorySyncManager } from '../services/whatsapp/IHistorySyncManager'
import { handleHistorySync, HistorySyncData } from '../historySync'
import { WASocket } from '../services/whatsapp/types'
import {
  SYNC_TYPE_INITIAL,
  SYNC_TYPE_FULL,
  SYNC_TYPE_RECENT,
  SYNC_TYPE_GROUP_HYDRATION,
  SYNC_AUTO_FINISH_THRESHOLD,
  HISTORY_SYNC_TIMEOUT_MS
} from '../constants'
import type { IAuthSettingsService } from '../services/auth/IAuthSettingsService'
import type { IAliasRepository } from '../services/contacts/IAliasRepository'
import type { IChatRepository } from '../services/chats/IChatRepository'
import type { ICommunityRepository } from '../services/chats/ICommunityRepository'
import type { IMessageRepository } from '../services/messages/IMessageRepository'
import type { IReactionRepository } from '../services/messages/IReactionRepository'
import type { IEmbeddingOperationalControl } from '../services/search/IEmbeddingService'
import type { IGroupHydrationService } from '../services/chats/IGroupHydrationService'
import type { IIdentityReconciliationService } from '../services/contacts/IIdentityReconciliationService'

type MediaType = 'image' | 'sticker' | 'video' | 'document' | 'audio'

interface HydratedTemplate {
  imageMessage?: unknown
  stickerMessage?: unknown
  videoMessage?: unknown
  documentMessage?: unknown
  audioMessage?: unknown
}

interface InteractiveTemplate {
  header?: {
    imageMessage?: unknown
    videoMessage?: unknown
    documentMessage?: unknown
  }
}

function resolveMediaType(
  unwrapped: Record<string, unknown>
): { mediaType: MediaType; mediaMsg: Record<string, unknown> } | null {
  let target = unwrapped

  if (unwrapped.templateMessage) {
    const tmpl = unwrapped.templateMessage as Record<string, unknown>
    const hydrated = (tmpl.hydratedFourRowTemplate || tmpl.hydratedTemplate) as HydratedTemplate | undefined
    const interactive = tmpl.interactiveMessageTemplate as InteractiveTemplate | undefined
    target = {
      imageMessage: hydrated?.imageMessage || interactive?.header?.imageMessage,
      stickerMessage: hydrated?.stickerMessage,
      videoMessage: hydrated?.videoMessage || interactive?.header?.videoMessage,
      documentMessage: hydrated?.documentMessage || interactive?.header?.documentMessage,
      audioMessage: hydrated?.audioMessage
    }
  }

  if (target.imageMessage) return { mediaType: 'image', mediaMsg: target.imageMessage as Record<string, unknown> }
  if (target.stickerMessage) return { mediaType: 'sticker', mediaMsg: target.stickerMessage as Record<string, unknown> }
  if (target.videoMessage) return { mediaType: 'video', mediaMsg: target.videoMessage as Record<string, unknown> }
  if (target.ptvMessage) return { mediaType: 'video', mediaMsg: target.ptvMessage as Record<string, unknown> }
  if (target.audioMessage) return { mediaType: 'audio', mediaMsg: target.audioMessage as Record<string, unknown> }
  if (target.documentMessage) {
    const doc = target.documentMessage as Record<string, unknown>
    const effectiveType: MediaType =
      typeof doc.mimetype === 'string' && doc.mimetype.startsWith('audio/')
        ? 'audio'
        : 'document'
    return { mediaType: effectiveType, mediaMsg: doc }
  }
  return null
}

async function streamToBuffer(stream: AsyncIterable<Buffer>): Promise<Buffer> {
  const chunks: Buffer[] = []
  for await (const chunk of stream) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))
  }
  return Buffer.concat(chunks)
}

function ensureBuffer(val: unknown): Buffer | null {
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

interface StickerMessageLike {
  localURI?: string | null;
  fileSha256?: unknown;
  mediaKey?: unknown;
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

const MSG_TYPE_STICKER = 'stickerMessage'
const MEDIA_TYPE_STICKER = 'sticker'
const MEDIA_PREFIX_APP = 'app://media/'
const DIR_NAME_MEDIA = 'media'
const CDN_DIRECT_STREAM_SUBSTRING = '/o1/'
const GROUP_JID_SUFFIX = '@g.us'

export class WorkerMediaService implements IMediaService {
  private favoriteStickerQueue: Array<{ msgId: string; sock: IMediaSocket }> = []
  private activeDownloadsCount = 0
  private concurrencyLimit = 2
  private isProcessingQueue = false
  private queuePaused = false

  constructor(
    private readonly messageRepository: IMessageCompoundRepository,
    private readonly messageQueryRepository: IMessageReadRepository,
    private readonly messageService: IMessageQueryService,
    private readonly messageParserService: IMessageParserService,
    private readonly contactService: IContactNameResolver,
    private readonly favoriteStickerService: IFavoriteStickerService,
    private readonly userDataPath: string
  ) {}

  setFavoriteStickerQueuePaused(paused: boolean): void {
    this.queuePaused = paused
    if (!paused) {
      this.processQueue().catch((err) => {
        console.error('[WorkerMediaService] Error resuming favorite sticker queue:', err)
      })
    }
  }

  clearFavoriteStickerQueue(): void {
    this.favoriteStickerQueue = []
    this.activeDownloadsCount = 0
    this.isProcessingQueue = false
  }

  private queueFavoriteStickerDownload(msgId: string, sock: IMediaSocket): void {
    if (!this.favoriteStickerQueue.some(item => item.msgId === msgId)) {
      this.favoriteStickerQueue.push({ msgId, sock })
    }
    this.processQueue().catch((err) => {
      console.error('[WorkerMediaService] Error processing favorite sticker queue:', err)
    })
  }

  private async processQueue(): Promise<void> {
    if (this.queuePaused || this.isProcessingQueue) return
    this.isProcessingQueue = true

    try {
      while (this.favoriteStickerQueue.length > 0 && !this.queuePaused) {
        if (this.activeDownloadsCount >= this.concurrencyLimit) {
          break
        }

        const item = this.favoriteStickerQueue.shift()
        if (!item) continue

        this.activeDownloadsCount++
        this.downloadAndCacheMedia(item.msgId, item.sock)
          .catch((err) => {
            console.error(`[WorkerMediaService] Background download of favorite sticker failed for msg ${item.msgId}:`, err)
          })
          .finally(() => {
            this.activeDownloadsCount--
            this.processQueue().catch((err) => {
              console.error('[WorkerMediaService] Error running processQueue in finally block:', err)
            })
          })
      }
    } finally {
      this.isProcessingQueue = false
    }
  }

  private extractStickerSha(mediaMsg: unknown): string | null {
    if (!mediaMsg || typeof mediaMsg !== 'object') return null
    const mediaObj = mediaMsg as Record<string, unknown>
    if (!mediaObj.fileSha256) return null
    const sha = mediaObj.fileSha256
    if (typeof sha === 'string') {
      return sha
    }
    if (Buffer.isBuffer(sha)) {
      return sha.toString('base64')
    }
    if (
      sha &&
      typeof sha === 'object' &&
      'type' in sha &&
      sha.type === 'Buffer' &&
      'data' in sha &&
      Array.isArray((sha as { data: unknown }).data)
    ) {
      return Buffer.from((sha as { data: number[] }).data).toString('base64')
    }
    if (sha instanceof Uint8Array || Array.isArray(sha)) {
      return Buffer.from(sha as Uint8Array).toString('base64')
    }
    return null
  }

  private buildShaToMsgMap(messages: Message[]): Map<string, Message[]> {
    const shaToMsgMap = new Map<string, Message[]>()
    for (const msg of messages) {
      if (msg.messageType !== MSG_TYPE_STICKER) continue
      try {
        const rawMessage = JSON.parse(msg.content) as Record<string, unknown>
        const unwrapped = unwrapMessage(rawMessage)
        const shaStr = this.extractStickerSha(unwrapped.stickerMessage)
        if (!shaStr) continue

        let list = shaToMsgMap.get(shaStr)
        if (!list) {
          list = []
          shaToMsgMap.set(shaStr, list)
        }
        list.push(msg)
      } catch (err) {
        console.error('[WorkerMediaService] Error checking sticker for sync auto-download:', err)
      }
    }
    return shaToMsgMap
  }

  async downloadFavoriteStickersFromSync(messages: Message[], sock: IMediaSocket | null): Promise<void> {
    if (!sock) return

    const shaToMsgMap = this.buildShaToMsgMap(messages)
    if (shaToMsgMap.size === 0) return

    try {
      const favRecords = await this.favoriteStickerService.findFavoritesByHashes(
        Array.from(shaToMsgMap.keys())
      )

      for (const fav of favRecords) {
        const msgs = shaToMsgMap.get(fav.fileSha256)
        if (!msgs) continue
        for (const msg of msgs) {
          this.queueFavoriteStickerDownload(msg.id, sock)
        }
      }
    } catch (err) {
      console.error('[WorkerMediaService] Failed to query favorite stickers in batch:', err)
    }
  }

  private async handleStickerAutoCopy(mediaMsg: Record<string, unknown>, filePath: string): Promise<void> {
    try {
      const shaStr = this.extractStickerSha(mediaMsg)
      if (shaStr) {
        await this.favoriteStickerService.handleDownloadedSticker(shaStr, filePath)
      }
    } catch (err) {
      console.error('[WorkerMediaService] Failed during auto-copy of favorite sticker check:', err)
    }
  }

  private prepareMediaDirectoryAndFileName(msgId: string, mediaType: MediaType, mediaMsg: Record<string, unknown>): { filePath: string; fileName: string } {
    const mediaDir = join(this.userDataPath, DIR_NAME_MEDIA)
    if (!fs.existsSync(mediaDir)) {
      fs.mkdirSync(mediaDir, { recursive: true })
    }
    const fileName = this.messageParserService.getSafeMediaFileName(msgId, mediaType, mediaMsg)
    return { filePath: join(mediaDir, fileName), fileName }
  }

  async downloadAndCacheMedia(msgId: string, sock: IMediaSocket | null): Promise<EnrichedMessage> {
    if (!sock) throw new Error('[WorkerMediaService] WhatsApp socket is not connected')

    const dbMsg = await this.messageQueryRepository.findMessageById(msgId)
    if (!dbMsg || !dbMsg.content) throw new Error('[WorkerMediaService] Message not found')

    const rawMessage = JSON.parse(dbMsg.content) as Record<string, unknown>
    const unwrapped = unwrapMessage(rawMessage)

    const resolved = resolveMediaType(unwrapped as Record<string, unknown>)
    if (!resolved) throw new Error('[WorkerMediaService] Not a media message')

    const { mediaType, mediaMsg } = resolved

    if (mediaMsg.mediaKey) {
      mediaMsg.mediaKey = ensureBuffer(mediaMsg.mediaKey)
    }

    const { filePath, fileName } = this.prepareMediaDirectoryAndFileName(msgId, mediaType, mediaMsg)

    if (!fs.existsSync(filePath)) {
      await this._downloadToFile(msgId, sock, dbMsg, rawMessage, mediaMsg, mediaType, filePath)
    }

    if (mediaType === MEDIA_TYPE_STICKER) {
      await this.handleStickerAutoCopy(mediaMsg, filePath)
    }

    mediaMsg.localURI = `${MEDIA_PREFIX_APP}${fileName}`

    const updated = await this.messageRepository.updateContentAndFetchWithSender(msgId, JSON.stringify(rawMessage))
    if (!updated) throw new Error('[WorkerMediaService] Failed to fetch updated message after media content update')

    const nameMap = await this.contactService.batchResolveNames([updated.participant || updated.chatJid], sock)
    return this.messageService.enrichMessage(updated, sock, nameMap)
  }

  private async _downloadToFile(
    msgId: string,
    sock: IMediaSocket,
    dbMsg: { id: string; chatJid: string; fromMe: boolean; participant: string | null },
    rawMessage: unknown,
    mediaMsg: Record<string, unknown>,
    mediaType: MediaType,
    filePath: string
  ): Promise<void> {
    const success = await this.downloadPrimaryCdn(msgId, mediaMsg, mediaType, filePath)
    if (success) return

    await this.downloadRetryUpdate(msgId, sock, dbMsg, rawMessage, mediaMsg, mediaType, filePath)
  }

  private async downloadPrimaryCdn(
    msgId: string,
    mediaMsg: Record<string, unknown>,
    mediaType: MediaType,
    filePath: string
  ): Promise<boolean> {
    try {
      const stream = await downloadContentFromMessage(
        mediaMsg as unknown as Parameters<typeof downloadContentFromMessage>[0],
        mediaType as unknown as Parameters<typeof downloadContentFromMessage>[1]
      )
      const buffer = await streamToBuffer(stream)
      if (buffer.length === 0) throw new Error('[WorkerMediaService] Downloaded stream was 0 bytes')
      fs.writeFileSync(filePath, buffer)
      return true
    } catch (primaryErr: unknown) {
      const primaryErrObj = primaryErr as Record<string, unknown> | null | undefined
      const outputObj = primaryErrObj?.output as Record<string, unknown> | undefined
      const statusCode = (outputObj?.statusCode ?? primaryErrObj?.statusCode) as number | undefined

      if (statusCode !== 403 && statusCode !== 404 && statusCode !== 410) {
        throw primaryErr
      }

      const dataObj = primaryErrObj?.data as Record<string, unknown> | undefined
      const isDirectStream = (dataObj?.url as string | undefined)?.includes(CDN_DIRECT_STREAM_SUBSTRING)
      console.warn(
        `[WorkerMediaService] Primary download failed (HTTP ${statusCode}${isDirectStream ? ', direct-stream /o1/' : ''}) for msg ${msgId} — attempting updateMediaMessage re-upload`
      )
      return false
    }
  }

  private buildUpdatePayload(rawMessage: unknown, mediaType: MediaType, mediaMsg: Record<string, unknown>, isTemplate: boolean): Record<string, unknown> {
    const rawMessageObj = rawMessage as Record<string, unknown>
    return isTemplate
      ? { [`${mediaType}Message`]: mediaMsg }
      : rawMessageObj
  }

  private extractUpdatedMetadata(updatedMsg: BaileysWebMessageInfo, isTemplate: boolean, mediaType: MediaType): { updatedMediaMsg: Record<string, unknown> | null; updatedMediaType: MediaType } {
    let updatedMediaMsg: Record<string, unknown> | null = null
    let updatedMediaType = mediaType

    if (isTemplate) {
      updatedMediaMsg = updatedMsg.message?.[`${mediaType}Message`] as Record<string, unknown> | undefined || null
    } else {
      const updatedUnwrapped = unwrapMessage(updatedMsg.message as Record<string, unknown>)
      const updatedResolved = resolveMediaType(updatedUnwrapped as Record<string, unknown>)
      if (updatedResolved) {
        updatedMediaMsg = updatedResolved.mediaMsg
        updatedMediaType = updatedResolved.mediaType
      }
    }
    return { updatedMediaMsg, updatedMediaType }
  }

  private async downloadRetryUpdate(
    msgId: string,
    sock: IMediaSocket,
    dbMsg: { id: string; chatJid: string; fromMe: boolean; participant: string | null },
    rawMessage: unknown,
    mediaMsg: Record<string, unknown>,
    mediaType: MediaType,
    filePath: string
  ): Promise<void> {
    if (!mediaMsg.mediaKey) {
      throw new Error(
        `[WorkerMediaService] Cannot download msg ${msgId}: mediaKey is missing. ` +
        `This is likely a history-sync stub without full media metadata.`
      )
    }

    try {
      const rawMessageObj = rawMessage as Record<string, unknown>
      const isTemplate = !!rawMessageObj.templateMessage
      const updatePayload = this.buildUpdatePayload(rawMessage, mediaType, mediaMsg, isTemplate)

      if (!sock.updateMediaMessage) {
        throw new Error('[WorkerMediaService] updateMediaMessage is not supported by the current socket context')
      }

      const updatedMsg = (await sock.updateMediaMessage({
        key: {
          id: dbMsg.id,
          remoteJid: dbMsg.chatJid,
          fromMe: dbMsg.fromMe,
          participant: dbMsg.chatJid.endsWith(GROUP_JID_SUFFIX)
            ? (dbMsg.participant || undefined)
            : undefined
        },
        message: updatePayload
      } as any)) as BaileysWebMessageInfo

      const { updatedMediaMsg, updatedMediaType } = this.extractUpdatedMetadata(updatedMsg, isTemplate, mediaType)

      if (!updatedMediaMsg) {
        throw new Error('[WorkerMediaService] updateMediaMessage returned no downloadable media node')
      }

      const stream = await downloadContentFromMessage(
        updatedMediaMsg as unknown as Parameters<typeof downloadContentFromMessage>[0],
        updatedMediaType as unknown as Parameters<typeof downloadContentFromMessage>[1]
      )
      const buffer = await streamToBuffer(stream)
      if (buffer.length === 0) throw new Error('[WorkerMediaService] Re-uploaded stream was 0 bytes')
      fs.writeFileSync(filePath, buffer)

      Object.assign(mediaMsg, updatedMediaMsg)

    } catch (retryErr: unknown) {
      const retryErrObj = retryErr as Record<string, unknown> | null | undefined
      const errMsg = retryErrObj?.message && typeof retryErrObj.message === 'string' ? retryErrObj.message : ''
      const isDecryptErr =
        errMsg.includes('authenticate') ||
        errMsg.includes('Unsupported state')

      const hint = isDecryptErr
        ? `mediaKey is present but failed AES-GCM decryption — this message was likely synced as a stub during history sync and its key is invalid.`
        : `updateMediaMessage request failed: ${errMsg || retryErr}`

      throw new Error(`[WorkerMediaService] Cannot download media for msg ${msgId}: ${hint}`)
    }
  }

  openFile(): Promise<boolean> {
    return Promise.resolve(false)
  }
}

export interface HistorySyncDependencies {
  mediaService: IMediaService
  embeddingService: IEmbeddingOperationalControl
  contactService: IContactQueryService & IContactMutationService & IContactCacheManager
  aliasRepository: IAliasRepository
  chatRepository: IChatRepository
  communityRepository: ICommunityRepository
  messageRepository: IMessageRepository
  reactionRepository: IReactionRepository
  groupHydrationService: IGroupHydrationService
  identityReconciliationService: IIdentityReconciliationService
}

export class WorkerHistorySyncManager implements IHistorySyncManager {
  private syncChunkCount = 0
  private maxProgress = 0
  private syncComplete = false
  private isInitialSyncInProgress = false
  private syncTimeout: NodeJS.Timeout | null = null

  constructor(
    private deps: HistorySyncDependencies,
    private readonly authSettingsService: IAuthSettingsService,
    private readonly postDomainEvent: (event: string, data?: any) => void
  ) {}

  public get isComplete(): boolean {
    return this.syncComplete
  }

  public get isInProgress(): boolean {
    return this.isInitialSyncInProgress
  }

  public setInProgress(val: boolean): void {
    this.isInitialSyncInProgress = val
  }

  public clear(): void {
    this.syncChunkCount = 0
    this.maxProgress = 0
    this.syncComplete = false
    this.isInitialSyncInProgress = false
    if (this.syncTimeout) {
      clearTimeout(this.syncTimeout)
      this.syncTimeout = null
    }
    this.deps.mediaService.clearFavoriteStickerQueue()
  }

  async handleSyncChunk(data: unknown, syncFullHistory: boolean, sock: WASocket): Promise<void> {
    try {
      this.deps.embeddingService.setPaused(true)
      this.deps.mediaService.setFavoriteStickerQueuePaused(true)
      this.isInitialSyncInProgress = true
      this.syncChunkCount++
      const rawData = data as Record<string, unknown>
      const reportedProgress = typeof rawData.progress === 'number' ? rawData.progress : undefined
      const syncType = typeof rawData.syncType === 'number' ? rawData.syncType : undefined

      if (this.syncTimeout) clearTimeout(this.syncTimeout)
      this.syncTimeout = setTimeout(() => this.finishSync(sock, syncFullHistory), HISTORY_SYNC_TIMEOUT_MS)

      const syncResult = await handleHistorySync(
        data as HistorySyncData,
        this.deps.contactService,
        this.deps.aliasRepository,
        this.deps.chatRepository,
        this.deps.communityRepository,
        this.deps.messageRepository,
        this.deps.reactionRepository
      )

      this.deps.mediaService.downloadFavoriteStickersFromSync(
        syncResult.importedMessages,
        sock
      ).catch((err) => {
        console.error('[WorkerHistorySync] Failed to process favorite stickers from sync:', err)
      })

      let calculatedProgress: number | undefined = undefined

      if (reportedProgress !== undefined) {
        if (syncType === SYNC_TYPE_INITIAL) {
          calculatedProgress = 0
        } else if (syncType === SYNC_TYPE_RECENT) {
          const min = 0
          const max = syncFullHistory ? 30 : 100
          calculatedProgress = Math.round(min + (reportedProgress / 100) * (max - min))
        } else if (syncType === SYNC_TYPE_FULL) {
          if (syncFullHistory) {
            const min = 30
            const max = 100
            calculatedProgress = Math.round(min + (reportedProgress / 100) * (max - min))
          }
        }
      }

      if (calculatedProgress !== undefined) {
        this.maxProgress = Math.max(this.maxProgress, calculatedProgress)
        this.postDomainEvent('wa-sync-progress', {
          progress: this.maxProgress,
          syncType,
          syncFullHistory
        })
        if (this.maxProgress >= SYNC_AUTO_FINISH_THRESHOLD) {
          await this.finishSync(sock, syncFullHistory)
        }
      }
    } catch (err) {
      console.error('[WorkerHistorySync] Error processing sync payload:', err)
    }
  }

  async finishSync(sock: WASocket, syncFullHistory: boolean): Promise<void> {
    if (this.syncComplete) return
    this.syncComplete = true
    this.isInitialSyncInProgress = false
    if (this.syncTimeout) {
      clearTimeout(this.syncTimeout)
      this.syncTimeout = null
    }
    console.log(`[WorkerHistorySync] Sync complete after ${this.syncChunkCount} chunks`)

    try {
      const groups = await sock.groupFetchAllParticipating()

      this.postDomainEvent('wa-sync-progress', {
        progress: 95,
        syncType: SYNC_TYPE_GROUP_HYDRATION,
        syncFullHistory
      })
      this.postDomainEvent('wa-sync-status', 'Fetching group metadata from WhatsApp...')
      await this.deps.groupHydrationService.hydrateGroups(groups, (progress, status) => {
        this.postDomainEvent('wa-sync-progress', {
          progress,
          syncType: SYNC_TYPE_GROUP_HYDRATION,
          syncFullHistory
        })
        this.postDomainEvent('wa-sync-status', status)
      }).catch((err) => {
        console.error('[WorkerHistorySync] Group hydration failed:', err)
      })
    } catch (err) {
      console.warn('[WorkerHistorySync] Failed to sync community metadata:', err)
    }

    console.log('[WorkerHistorySync] Running post-sync identity reconciliation...')
    await this.deps.identityReconciliationService.deduplicateIdentities().catch((err) => {
      console.warn('[WorkerHistorySync] deduplicateIdentities error:', err)
    })

    this.deps.contactService.clearCaches()

    this.deps.embeddingService.setPaused(false)
    this.deps.mediaService.setFavoriteStickerQueuePaused(false)

    await this.authSettingsService.setHistorySyncCompleted().catch((err) => {
      console.error('[WorkerHistorySync] Failed to save history sync complete status:', err)
    })

    this.postDomainEvent('wa-sync-progress', {
      progress: 100,
      syncType: SYNC_TYPE_GROUP_HYDRATION,
      syncFullHistory
    })
    this.postDomainEvent('wa-sync-complete')
  }

  async skipSync(sock: WASocket): Promise<void> {
    const syncFullHistory = await this.authSettingsService.getSyncFullHistory()
    await this.finishSync(sock, syncFullHistory)
  }
}
