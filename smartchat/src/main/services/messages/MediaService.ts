import { downloadContentFromMessage, proto } from '@whiskeysockets/baileys'
import { app, shell } from 'electron'
import { join } from 'path'
import fs from 'fs'
import { IMessageQueryService } from './IMessageQueryService'
import { IMessageParserService } from './IMessageParserService'
import { IMessageRepository } from './IMessageRepository'
import { IMessageQueryRepository } from './IMessageQueryRepository'
import { IFavoriteStickerService } from './IFavoriteStickerService'
import { IContactService } from '../contacts/IContactService'
import { WASocket } from '../whatsapp/types'
import { EnrichedMessage } from '../../ipc/types'
import { unwrapMessage } from '../../utils'
import { Message } from '@prisma/client'
import { IMediaService } from './IMediaService'

// ─── helpers ────────────────────────────────────────────────────────────────

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

/** Resolve the correct Baileys media type string, with HKDF override for
 *  audio files that arrived inside a documentMessage wrapper. */
function resolveMediaType(
  unwrapped: proto.IMessage | Record<string, unknown>
): { mediaType: MediaType; mediaMsg: Record<string, unknown> } | null {
  let target = unwrapped as Record<string, unknown>

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
    // HKDF label correction: an audio file sent as a generic document must be
    // downloaded with type='audio' so the key-derivation uses "WhatsApp Audio Keys"
    // instead of "WhatsApp Document Keys".
    const doc = target.documentMessage as Record<string, unknown>
    const effectiveType: MediaType =
      typeof doc.mimetype === 'string' && doc.mimetype.startsWith('audio/')
        ? 'audio'
        : 'document'
    return { mediaType: effectiveType, mediaMsg: doc }
  }
  return null
}

/** Collect all chunks from a Baileys Transform stream into a Buffer.
 *  Using manual chunk collection (not `Buffer.concat` inside buffer-mode) avoids
 *  the 0-byte audio bug caused by the Readable.fromWeb / PassThrough type mismatch
 *  in some Baileys releases. */
async function streamToBuffer(stream: AsyncIterable<Buffer>): Promise<Buffer> {
  const chunks: Buffer[] = []
  for await (const chunk of stream) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))
  }
  const result = Buffer.concat(chunks)
  return result
}

/** Robustly ensures the value is converted back to a Buffer.
 *  Handles string (base64/hex), Uint8Array, { type: 'Buffer', data: [...] }, and Buffer. */
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
      return Buffer.from(obj.data)
    }
    if (Array.isArray(val)) {
      return Buffer.from(val)
    }
  }
  return null
}

// ─── service ────────────────────────────────────────────────────────────────

const MSG_TYPE_STICKER = 'stickerMessage'
const MEDIA_TYPE_STICKER = 'sticker'
const MEDIA_PREFIX_APP = 'app://media/'
const DIR_NAME_MEDIA = 'media'
const CDN_DIRECT_STREAM_SUBSTRING = '/o1/'
const GROUP_JID_SUFFIX = '@g.us'

/**
 * Service for downloading, caching, and opening message media.
 *
 * Error handling contract:
 * - Methods throw Error with [MediaService] prefix for socket/message/download issues.
 * - Silent failures or boolean return values are used only in non-critical paths like openFile.
 */
export class MediaService implements IMediaService {
  private favoriteStickerQueue: Array<{ msgId: string; sock: WASocket }> = []
  private activeDownloadsCount = 0
  private concurrencyLimit = 2
  private isProcessingQueue = false
  private queuePaused = false

  constructor(
    private readonly messageRepository: IMessageRepository,
    private readonly messageQueryRepository: IMessageQueryRepository,
    private readonly messageService: IMessageQueryService,
    private readonly messageParserService: IMessageParserService,
    private readonly contactService: IContactService,
    private readonly favoriteStickerService: IFavoriteStickerService
  ) { }

  setFavoriteStickerQueuePaused(paused: boolean): void {
    this.queuePaused = paused
    if (!paused) {
      this.processQueue().catch((err) => {
        console.error('[MediaService] Error resuming favorite sticker queue:', err)
      })
    }
  }

  clearFavoriteStickerQueue(): void {
    this.favoriteStickerQueue = []
    this.activeDownloadsCount = 0
    this.isProcessingQueue = false
  }

  private queueFavoriteStickerDownload(msgId: string, sock: WASocket): void {
    if (!this.favoriteStickerQueue.some(item => item.msgId === msgId)) {
      this.favoriteStickerQueue.push({ msgId, sock })
    }
    this.processQueue().catch((err) => {
      console.error('[MediaService] Error processing favorite sticker queue:', err)
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
            console.error(`[MediaService] Background download of favorite sticker failed for msg ${item.msgId}:`, err)
          })
          .finally(() => {
            this.activeDownloadsCount--
            this.processQueue().catch((err) => {
              console.error('[MediaService] Error running processQueue in finally block:', err)
            })
          })
      }
    } finally {
      this.isProcessingQueue = false
    }
  }

  private extractStickerSha(mediaMsg: any): string | null {
    if (!mediaMsg || !mediaMsg.fileSha256) return null
    const sha = mediaMsg.fileSha256
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

  async downloadFavoriteStickersFromSync(messages: Message[], sock: WASocket | null): Promise<void> {
    if (!sock) return

    // 1. Gather all unique sticker SHA hashes and map them to their corresponding messages
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
        console.error('[MediaService] Error checking sticker for sync auto-download:', err)
      }
    }

    if (shaToMsgMap.size === 0) return

    // 2. Query all matching favorite stickers in a single DB query
    try {
      const favRecords = await this.favoriteStickerService.findFavoritesByHashes(
        Array.from(shaToMsgMap.keys())
      )

      // 3. For each match, queue the download
      for (const fav of favRecords) {
        const msgs = shaToMsgMap.get(fav.fileSha256)
        if (msgs) {
          for (const msg of msgs) {
            this.queueFavoriteStickerDownload(msg.id, sock)
          }
        }
      }
    } catch (err) {
      console.error('[MediaService] Failed to query favorite stickers in batch:', err)
    }
  }

  private async handleStickerAutoCopy(mediaMsg: Record<string, unknown>, filePath: string): Promise<void> {
    try {
      const shaStr = this.extractStickerSha(mediaMsg)
      if (shaStr) {
        await this.favoriteStickerService.handleDownloadedSticker(shaStr, filePath)
      }
    } catch (err) {
      console.error('[MediaService] Failed during favorite sticker auto-copy check:', err)
    }
  }

  async downloadAndCacheMedia(msgId: string, sock: WASocket | null): Promise<EnrichedMessage> {
    if (!sock) throw new Error('[MediaService] WhatsApp socket is not connected')

    const dbMsg = await this.messageQueryRepository.findMessageById(msgId)
    if (!dbMsg || !dbMsg.content) throw new Error('[MediaService] Message not found')

    const rawMessage = JSON.parse(dbMsg.content) as Record<string, unknown>
    const unwrapped = unwrapMessage(rawMessage)

    const resolved = resolveMediaType(unwrapped)
    if (!resolved) throw new Error('[MediaService] Not a media message')

    const { mediaType, mediaMsg } = resolved

    if (mediaMsg.mediaKey) {
      mediaMsg.mediaKey = ensureBuffer(mediaMsg.mediaKey)
    }

    const mediaDir = join(app.getPath('userData'), DIR_NAME_MEDIA)
    if (!fs.existsSync(mediaDir)) fs.mkdirSync(mediaDir, { recursive: true })

    const fileName = this.messageParserService.getSafeMediaFileName(msgId, mediaType, mediaMsg)
    const filePath = join(mediaDir, fileName)

    if (!fs.existsSync(filePath)) {
      await this._downloadToFile(msgId, sock, dbMsg, rawMessage, mediaMsg, mediaType, filePath)
    }

    // Self-healing: if this is a sticker and it matches a favorite sticker, copy it to favourites
    if (mediaType === MEDIA_TYPE_STICKER) {
      await this.handleStickerAutoCopy(mediaMsg, filePath)
    }

    // Stamp the local URI back onto the resolved media message payload so the DB gets updated
    mediaMsg.localURI = `${MEDIA_PREFIX_APP}${fileName}`

    const updated = await this.messageRepository.updateContentAndFetchWithSender(msgId, JSON.stringify(rawMessage))
    if (!updated) throw new Error('[MediaService] Failed to fetch updated message after media content update')

    const nameMap = await this.contactService.batchResolveNames(
      [updated.participant || updated.chatJid],
      sock
    )
    return this.messageService.enrichMessage(updated, sock, nameMap)
  }

  // ── download pipeline ──────────────────────────────────────────────────────

  private async _downloadToFile(
    msgId: string,
    sock: WASocket,
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
      if (buffer.length === 0) throw new Error('[MediaService] Downloaded stream was 0 bytes')
      fs.writeFileSync(filePath, buffer)
      return true
    } catch (primaryErr: unknown) {
      const primaryErrObj = primaryErr as Record<string, any> | null | undefined
      const statusCode: number | undefined =
        primaryErrObj?.output?.statusCode ?? primaryErrObj?.statusCode

      // Only retry on known recoverable CDN errors
      if (statusCode !== 403 && statusCode !== 404 && statusCode !== 410) {
        throw primaryErr
      }

      const isDirectStream = (primaryErrObj?.data?.url as string | undefined)?.includes(CDN_DIRECT_STREAM_SUBSTRING)
      console.warn(
        `[MediaService] Primary download failed (HTTP ${statusCode}${isDirectStream ? ', direct-stream /o1/' : ''}) for msg ${msgId} — attempting updateMediaMessage re-upload`
      )
      return false
    }
  }

  private async downloadRetryUpdate(
    msgId: string,
    sock: WASocket,
    dbMsg: { id: string; chatJid: string; fromMe: boolean; participant: string | null },
    rawMessage: unknown,
    mediaMsg: Record<string, unknown>,
    mediaType: MediaType,
    filePath: string
  ): Promise<void> {
    // Requires a valid mediaKey: the response is AES-GCM encrypted with it.
    if (!mediaMsg.mediaKey) {
      throw new Error(
        `[MediaService] Cannot download msg ${msgId}: mediaKey is missing. ` +
        `This is likely a history-sync stub without full media metadata.`
      )
    }

    try {
      // Synthesize a standard media message structure if the media is nested inside a templateMessage.
      const rawMessageObj = rawMessage as Record<string, unknown>
      const isTemplate = !!rawMessageObj.templateMessage
      const updatePayload = isTemplate
        ? { [`${mediaType}Message`]: mediaMsg }
        : rawMessageObj

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
      } as unknown as Parameters<typeof sock.updateMediaMessage>[0])) as proto.IWebMessageInfo

      // Extract the updated media metadata back
      let updatedMediaMsg: Record<string, unknown> | null = null
      let updatedMediaType = mediaType

      if (isTemplate) {
        updatedMediaMsg = updatedMsg.message?.[`${mediaType}Message`] as Record<string, unknown> | undefined || null
      } else {
        const updatedUnwrapped = unwrapMessage(updatedMsg.message as Record<string, unknown>)
        const updatedResolved = resolveMediaType(updatedUnwrapped)
        if (updatedResolved) {
          updatedMediaMsg = updatedResolved.mediaMsg
          updatedMediaType = updatedResolved.mediaType
        }
      }

      if (!updatedMediaMsg) {
        throw new Error('[MediaService] updateMediaMessage returned no downloadable media node')
      }

      const stream = await downloadContentFromMessage(
        updatedMediaMsg as unknown as Parameters<typeof downloadContentFromMessage>[0],
        updatedMediaType as unknown as Parameters<typeof downloadContentFromMessage>[1]
      )
      const buffer = await streamToBuffer(stream)
      if (buffer.length === 0) throw new Error('[MediaService] Re-uploaded stream was 0 bytes')
      fs.writeFileSync(filePath, buffer)

      // Merge the refreshed media metadata back so callers see the new URL
      Object.assign(mediaMsg, updatedMediaMsg)

    } catch (retryErr: unknown) {
      const retryErrObj = retryErr as Record<string, any> | null | undefined
      const errMsg = retryErrObj?.message && typeof retryErrObj.message === 'string' ? retryErrObj.message : ''
      const isDecryptErr =
        errMsg.includes('authenticate') ||
        errMsg.includes('Unsupported state')

      const hint = isDecryptErr
        ? `mediaKey is present but failed AES-GCM decryption — this message was likely synced as a stub during history sync and its key is invalid.`
        : `updateMediaMessage request failed: ${errMsg || retryErr}`

      throw new Error(`[MediaService] Cannot download media for msg ${msgId}: ${hint}`)
    }
  }

  // ── file opener ───────────────────────────────────────────────────────────

  async openFile(localURI: string): Promise<boolean> {
    try {
      const fileName = decodeURIComponent(localURI.split('/').pop() || '')
      if (!fileName) return false

      const filePath = join(app.getPath('userData'), DIR_NAME_MEDIA, fileName)
      if (fs.existsSync(filePath)) {
        await shell.openPath(filePath)
        return true
      }
      return false
    } catch {
      return false
    }
  }
}
