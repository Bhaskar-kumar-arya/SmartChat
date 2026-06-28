import { Message } from '@prisma/client'
import * as fs from 'fs'
import { join } from 'path'
import { downloadContentFromMessage } from '@whiskeysockets/baileys'
import { unwrapMessage } from '../../../utils/messageUtils'
import { IMediaService, IMediaSocket } from '../../../services/messages/IMediaService'
import { IMessageCompoundRepository } from '../../../services/messages/IMessageCompoundRepository'
import { IMessageReadRepository } from '../../../services/messages/IMessageQueryRepository'
import { IMessageEnricher } from '../../../services/messages/IMessageEnricher'
import { IContactNameResolver } from '../../../services/contacts/IContactService'
import { IFavoriteStickerService } from '../../../services/messages/IFavoriteStickerService'
import { getSafeMediaFileName } from '../../../services/messages/MediaHelper'
import { EnrichedMessage } from '../../../ipc/message.types'
import { BaileysWebMessageInfo } from '../../../services/whatsapp/types'
import { MediaType, resolveMediaType, ensureBuffer, streamToBuffer, extractStickerSha } from '../utils/workerUtils'

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
    private readonly messageEnricher: IMessageEnricher,
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

  private buildShaToMsgMap(messages: Message[]): Map<string, Message[]> {
    const shaToMsgMap = new Map<string, Message[]>()
    for (const msg of messages) {
      if (msg.messageType !== MSG_TYPE_STICKER) continue
      try {
        const rawMessage = JSON.parse(msg.content) as Record<string, unknown>
        const unwrapped = unwrapMessage(rawMessage)
        const shaStr = extractStickerSha(unwrapped.stickerMessage)
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
      const shaStr = extractStickerSha(mediaMsg)
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
    const fileName = getSafeMediaFileName(msgId, mediaType, mediaMsg)
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
    return this.messageEnricher.enrichMessage(updated, sock, nameMap)
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
      })) as BaileysWebMessageInfo

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
