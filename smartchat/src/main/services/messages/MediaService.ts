import { downloadContentFromMessage } from '@whiskeysockets/baileys'
import { PrismaClient, Message } from '@prisma/client'
import { app, shell } from 'electron'
import { join } from 'path'
import fs from 'fs'
import { MessageService } from './MessageService'
import { FavoriteStickerService } from './FavoriteStickerService'
import { ContactService } from '../contacts/ContactService'
import { EnrichedMessage, WASocket } from '../../types'
import { unwrapMessage } from '../../utils'

// ─── helpers ────────────────────────────────────────────────────────────────

type MediaType = 'image' | 'sticker' | 'video' | 'document' | 'audio'

/** Resolve the correct Baileys media type string, with HKDF override for
 *  audio files that arrived inside a documentMessage wrapper. */
function resolveMediaType(
  unwrapped: Record<string, any>
): { mediaType: MediaType; mediaMsg: Record<string, any> } | null {
  let target = unwrapped

  if (unwrapped.templateMessage) {
    const tmpl = unwrapped.templateMessage
    const hydrated = tmpl.hydratedFourRowTemplate || tmpl.hydratedTemplate
    const interactive = tmpl.interactiveMessageTemplate
    target = {
      imageMessage: hydrated?.imageMessage || interactive?.header?.imageMessage,
      stickerMessage: hydrated?.stickerMessage,
      videoMessage: hydrated?.videoMessage || interactive?.header?.videoMessage,
      documentMessage: hydrated?.documentMessage || interactive?.header?.documentMessage,
      audioMessage: hydrated?.audioMessage
    }
  }

  if (target.imageMessage) return { mediaType: 'image', mediaMsg: target.imageMessage }
  if (target.stickerMessage) return { mediaType: 'sticker', mediaMsg: target.stickerMessage }
  if (target.videoMessage) return { mediaType: 'video', mediaMsg: target.videoMessage }
  if (target.ptvMessage) return { mediaType: 'video', mediaMsg: target.ptvMessage }
  if (target.audioMessage) return { mediaType: 'audio', mediaMsg: target.audioMessage }
  if (target.documentMessage) {
    // HKDF label correction: an audio file sent as a generic document must be
    // downloaded with type='audio' so the key-derivation uses "WhatsApp Audio Keys"
    // instead of "WhatsApp Document Keys".
    const doc = target.documentMessage
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
function ensureBuffer(val: any): Buffer | null {
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
    if (val.type === 'Buffer' && Array.isArray(val.data)) {
      return Buffer.from(val.data)
    }
    if (Array.isArray(val)) {
      return Buffer.from(val)
    }
  }
  return null
}

// ─── service ────────────────────────────────────────────────────────────────

export class MediaService {
  constructor(
    private prisma: PrismaClient,
    private messageService: MessageService,
    private contactService: ContactService,
    private favoriteStickerService: FavoriteStickerService
  ) { }

  async downloadFavoriteStickersFromSync(messages: Message[], sock: WASocket | null): Promise<void> {
    if (!sock) return

    for (const msg of messages) {
      if (msg.messageType === 'stickerMessage') {
        try {
          const rawMessage = JSON.parse(msg.content)
          const unwrapped = unwrapMessage(rawMessage)
          const stickerMsg = unwrapped.stickerMessage
          if (stickerMsg && stickerMsg.fileSha256) {
            let shaStr = ''
            const sha = stickerMsg.fileSha256
            if (typeof sha === 'string') {
              shaStr = sha
            } else if (Buffer.isBuffer(sha)) {
              shaStr = sha.toString('base64')
            } else if (sha && typeof sha === 'object' && sha.type === 'Buffer' && Array.isArray(sha.data)) {
              shaStr = Buffer.from(sha.data).toString('base64')
            } else if (sha instanceof Uint8Array || Array.isArray(sha)) {
              shaStr = Buffer.from(sha).toString('base64')
            }

            if (shaStr) {
              const favRecord = await this.prisma.favoriteSticker.findUnique({
                where: { fileSha256: shaStr }
              })
              if (favRecord) {
                console.log(`[MediaService] Detected matching favorite sticker message: ${msg.id} (SHA: ${shaStr}), triggering auto-download...`)
                this.downloadAndCacheMedia(msg.id, sock).catch((err) => {
                  console.error(`[MediaService] Failed to auto-download favorite sticker for msg ${msg.id}:`, err)
                })
              }
            }
          }
        } catch (err) {
          console.error('[MediaService] Error checking sticker for sync auto-download:', err)
        }
      }
    }
  }

  async downloadAndCacheMedia(msgId: string, sock: WASocket | null): Promise<EnrichedMessage> {
    if (!sock) throw new Error('WhatsApp socket is not connected')

    const dbMsg = await this.prisma.message.findUnique({ where: { id: msgId } })
    if (!dbMsg || !dbMsg.content) throw new Error('Message not found')

    const rawMessage = JSON.parse(dbMsg.content)
    const unwrapped = unwrapMessage(rawMessage)

    const resolved = resolveMediaType(unwrapped)
    if (!resolved) throw new Error('Not a media message')

    const { mediaType, mediaMsg } = resolved

    if (mediaMsg.mediaKey) {
      mediaMsg.mediaKey = ensureBuffer(mediaMsg.mediaKey)
    }

    const mediaDir = join(app.getPath('userData'), 'media')
    if (!fs.existsSync(mediaDir)) fs.mkdirSync(mediaDir, { recursive: true })

    const fileName = this.messageService.getSafeMediaFileName(msgId, mediaType, mediaMsg)
    const filePath = join(mediaDir, fileName)

    if (!fs.existsSync(filePath)) {
      await this._downloadToFile(msgId, sock, dbMsg, rawMessage, mediaMsg, mediaType, filePath)
    }

    // Self-healing: if this is a sticker and it matches a favorite sticker, copy it to favourites
    if (mediaType === 'sticker') {
      try {
        let shaStr = ''
        if (mediaMsg.fileSha256) {
          const sha = mediaMsg.fileSha256
          if (typeof sha === 'string') {
            shaStr = sha
          } else if (Buffer.isBuffer(sha)) {
            shaStr = sha.toString('base64')
          } else if (sha && typeof sha === 'object' && sha.type === 'Buffer' && Array.isArray(sha.data)) {
            shaStr = Buffer.from(sha.data).toString('base64')
          } else if (sha instanceof Uint8Array || Array.isArray(sha)) {
            shaStr = Buffer.from(sha).toString('base64')
          }
        }

        if (shaStr) {
          await this.favoriteStickerService.handleDownloadedSticker(shaStr, filePath)
        }
      } catch (err) {
        console.error('[MediaService] Failed during favorite sticker auto-copy check:', err)
      }
    }

    // Stamp the local URI back onto the resolved media message payload so the DB gets updated
    mediaMsg.localURI = `app://media/${fileName}`

    const updated = await this.prisma.message.update({
      where: { id: msgId },
      data: { content: JSON.stringify(rawMessage) },
      include: { sender: true }
    })

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
    rawMessage: any,
    mediaMsg: Record<string, any>,
    mediaType: MediaType,
    filePath: string
  ): Promise<void> {

    // ── Primary attempt ────────────────────────────────────────────────────
    // downloadContentFromMessage already falls back to directPath internally if the
    // URL is not a valid mmg.whatsapp.net link — so we don't need a manual rewrite.
    try {
      const stream = await downloadContentFromMessage(mediaMsg as any, mediaType as any)
      const buffer = await streamToBuffer(stream)
      if (buffer.length === 0) throw new Error('Downloaded stream was 0 bytes')
      fs.writeFileSync(filePath, buffer)
      return
    } catch (primaryErr: any) {
      const statusCode: number | undefined =
        primaryErr?.output?.statusCode ?? primaryErr?.statusCode

      // Only retry on known recoverable CDN errors
      if (statusCode !== 403 && statusCode !== 404 && statusCode !== 410) {
        throw primaryErr
      }

      const isDirectStream = (primaryErr?.data?.url as string | undefined)?.includes('/o1/')
      console.warn(
        `[MediaService] Primary download failed (HTTP ${statusCode}${isDirectStream ? ', direct-stream /o1/' : ''}) for msg ${msgId} — attempting updateMediaMessage re-upload`
      )
    }

    // ── Retry via updateMediaMessage ───────────────────────────────────────
    // This sends a WebSocket signal to WhatsApp servers asking the sender's phone
    // to re-upload the media to the CDN and return a fresh URL.
    //
    // Requires a valid mediaKey: the response is AES-GCM encrypted with it.
    // History-sync stubs sometimes carry a corrupted/placeholder key → decryption
    // will fail with "Unsupported state or unable to authenticate data".
    if (!mediaMsg.mediaKey) {
      throw new Error(
        `[MediaService] Cannot download msg ${msgId}: mediaKey is missing. ` +
        `This is likely a history-sync stub without full media metadata.`
      )
    }

    try {
      // Synthesize a standard media message structure if the media is nested inside a templateMessage.
      // This is because Baileys' updateMediaMessage depends on assertMediaContent, which lacks support
      // for extracting media from newer template schemas like interactiveMessageTemplate.
      const isTemplate = !!rawMessage.templateMessage
      const updatePayload = isTemplate
        ? { [`${mediaType}Message`]: mediaMsg }
        : rawMessage

      const updatedMsg = await sock.updateMediaMessage({
        key: {
          id: dbMsg.id,
          remoteJid: dbMsg.chatJid,
          fromMe: dbMsg.fromMe,
          participant: dbMsg.chatJid.endsWith('@g.us')
            ? (dbMsg.participant || undefined)
            : undefined
        },
        message: updatePayload
      } as any)

      // Extract the updated media metadata back
      let updatedMediaMsg: any = null
      let updatedMediaType = mediaType

      if (isTemplate) {
        updatedMediaMsg = updatedMsg.message?.[`${mediaType}Message`]
      } else {
        const updatedUnwrapped = unwrapMessage(updatedMsg.message)
        const updatedResolved = resolveMediaType(updatedUnwrapped)
        if (updatedResolved) {
          updatedMediaMsg = updatedResolved.mediaMsg
          updatedMediaType = updatedResolved.mediaType
        }
      }

      if (!updatedMediaMsg) {
        throw new Error('updateMediaMessage returned no downloadable media node')
      }

      const stream = await downloadContentFromMessage(
        updatedMediaMsg as any,
        updatedMediaType as any
      )
      const buffer = await streamToBuffer(stream)
      if (buffer.length === 0) throw new Error('Re-uploaded stream was 0 bytes')
      fs.writeFileSync(filePath, buffer)

      // Merge the refreshed media metadata back so callers see the new URL
      Object.assign(mediaMsg, updatedMediaMsg)

    } catch (retryErr: any) {
      const isDecryptErr =
        retryErr?.message?.includes('authenticate') ||
        retryErr?.message?.includes('Unsupported state')

      const hint = isDecryptErr
        ? `mediaKey is present but failed AES-GCM decryption — this message was likely synced as a stub during history sync and its key is invalid.`
        : `updateMediaMessage request failed: ${retryErr?.message ?? retryErr}`

      throw new Error(`[MediaService] Cannot download media for msg ${msgId}: ${hint}`)
    }
  }

  // ── file opener ───────────────────────────────────────────────────────────

  async openFile(localURI: string): Promise<boolean> {
    try {
      const fileName = decodeURIComponent(localURI.split('/').pop() || '')
      if (!fileName) return false

      const filePath = join(app.getPath('userData'), 'media', fileName)
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
