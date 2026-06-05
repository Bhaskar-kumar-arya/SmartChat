import { downloadContentFromMessage } from '@whiskeysockets/baileys'
import { PrismaClient } from '@prisma/client'
import { app, shell } from 'electron'
import { join } from 'path'
import fs from 'fs'
import { MessageService } from './MessageService'
import { ContactService } from '../contacts/ContactService'
import { EnrichedMessage, WASocket } from '../../types'
import { unwrapMessage } from '../../utils'


export class MediaService {
  constructor(
    private prisma: PrismaClient,
    private messageService: MessageService,
    private contactService: ContactService
  ) {}

  async downloadAndCacheMedia(msgId: string, sock: WASocket | null): Promise<EnrichedMessage> {
    if (!sock) throw new Error('WhatsApp socket is not connected')

    const dbMsg = await this.prisma.message.findUnique({ where: { id: msgId } })
    if (!dbMsg || !dbMsg.content) throw new Error('Message not found')

    const rawMessage = JSON.parse(dbMsg.content)
    const unwrapped = unwrapMessage(rawMessage)
    
    let mediaType: 'image' | 'sticker' | 'video' | 'document' | 'audio' | null = null
    if (unwrapped.imageMessage) mediaType = 'image'
    else if (unwrapped.stickerMessage) mediaType = 'sticker'
    else if (unwrapped.videoMessage) mediaType = 'video'
    else if (unwrapped.documentMessage) mediaType = 'document'
    else if (unwrapped.audioMessage) mediaType = 'audio'

    const mediaMsg = unwrapped.imageMessage || unwrapped.stickerMessage || unwrapped.videoMessage || unwrapped.documentMessage || unwrapped.audioMessage

    if (!mediaMsg || !mediaType) throw new Error('Not a media message')

    const mediaDir = join(app.getPath('userData'), 'media')
    if (!fs.existsSync(mediaDir)) fs.mkdirSync(mediaDir, { recursive: true })

    const fileName = this.messageService.getSafeMediaFileName(msgId, mediaType, mediaMsg)
    const filePath = join(mediaDir, fileName)

    if (!fs.existsSync(filePath)) {
      try {
        const stream = await downloadContentFromMessage(mediaMsg, mediaType as any)
        let buffer = Buffer.from([])
        for await (const chunk of stream) buffer = Buffer.concat([buffer, chunk])
        fs.writeFileSync(filePath, buffer)
      } catch (err: any) {
        if (err?.data === 410 || err?.output?.statusCode === 410) {
          const updatedMsg = await sock.updateMediaMessage({
            key: {
              id: dbMsg.id,
              remoteJid: dbMsg.chatJid,
              fromMe: dbMsg.fromMe,
              participant: dbMsg.chatJid.endsWith('@g.us') ? (dbMsg.participant || undefined) : undefined
            },
            message: rawMessage
          } as any)
          const updatedMedia = unwrapMessage(updatedMsg.message)
          const target = updatedMedia.imageMessage || updatedMedia.stickerMessage || updatedMedia.videoMessage || updatedMedia.audioMessage
          if (target) {
            const stream = await downloadContentFromMessage(target, mediaType as any)
            let buffer = Buffer.from([])
            for await (const chunk of stream) buffer = Buffer.concat([buffer, chunk])
            fs.writeFileSync(filePath, buffer)
            Object.assign(unwrapped, updatedMedia)
          }
        } else throw err
      }
    }

    if (unwrapped.imageMessage) unwrapped.imageMessage.localURI = `app://media/${fileName}`
    if (unwrapped.stickerMessage) unwrapped.stickerMessage.localURI = `app://media/${fileName}`
    if (unwrapped.videoMessage) unwrapped.videoMessage.localURI = `app://media/${fileName}`
    if (unwrapped.documentMessage) unwrapped.documentMessage.localURI = `app://media/${fileName}`
    if (unwrapped.audioMessage) unwrapped.audioMessage.localURI = `app://media/${fileName}`

    const updated = await this.prisma.message.update({
      where: { id: msgId },
      data: { content: JSON.stringify(rawMessage) },
      include: { sender: true }
    })

    const nameMap = await this.contactService.batchResolveNames([updated.participant || updated.chatJid], sock)
    return this.messageService.enrichMessage(updated, sock, nameMap)
  }

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
    } catch (err) {
      return false
    }
  }
}
