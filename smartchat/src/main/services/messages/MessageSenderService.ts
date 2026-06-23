import { IContactNameResolver, IContactQueryService } from '../contacts/IContactService'
import { join } from 'path'
import { IMessageProcessingService } from './IMessageProcessingService'
import { IMessageParserService } from './IMessageParserService'
import { IMessageQueryService } from './IMessageQueryService'
import { IMessageWriteRepository } from './IMessageRepository'
import { IMessageCompoundRepository } from './IMessageCompoundRepository'
import { IMessageReadRepository } from './IMessageQueryRepository'
import { IChatService } from '../chats/IChatService'
import { AnyMessageContent } from '@whiskeysockets/baileys'
import { MediaMessageWithLocalUri, WAContextInfo, parseProtoMessage } from '../whatsapp/types'
import { EnrichedMessage } from '../../ipc/message.types'
import { cleanJid } from '../../utils/jidUtils'
import { unwrapMessage } from '../../utils/messageUtils'
import type { IWAEventBus } from '../whatsapp/IWAEventBus'
import { stickerMetadataService } from './StickerMetadataService'
import { getMediaSendOptions } from './MediaHelper'
import { LocalFileStorage } from '../storage/LocalFileStorage'
import { IMessageSenderService } from './IMessageSenderService'
import { IMessageActionSocket } from './IMessageActionService'
import { ProcessedMessage } from '../../domain/db.types'
import { randomBytes } from 'crypto'

const JID_SUFFIX_GROUP = '@g.us'
const JID_SUFFIX_LID = '@lid'
const APP_FAVOURITES_PREFIX = 'app://favourites/'
const APP_MEDIA_PREFIX = 'app://media/'

export class MessageSenderService implements IMessageSenderService {
  private readonly fileStorage: LocalFileStorage

  constructor(
    private readonly messageRepository: IMessageWriteRepository & IMessageCompoundRepository,
    private readonly messageQueryRepository: IMessageReadRepository,
    private readonly contactService: IContactNameResolver & IContactQueryService,
    private readonly messageProcessingService: IMessageProcessingService,
    private readonly messageParserService: IMessageParserService,
    private readonly messageQueryService: IMessageQueryService,
    private readonly chatService: IChatService,
    private readonly getBus: () => IWAEventBus | null,
    fileStorage?: LocalFileStorage
  ) {
    this.fileStorage = fileStorage ?? new LocalFileStorage()
  }

  private async buildQuotedContextInfo(
    quotedMsgId: string,
    targetJid: string,
    sock: IMessageActionSocket
  ): Promise<WAContextInfo | undefined> {
    const qm = await this.messageQueryRepository.findMessageById(quotedMsgId)
    if (!qm || !qm.content) return undefined

    try { 
      const rawQuoted = JSON.parse(qm.content)
      const msgType = Object.keys(rawQuoted)[0]
      if (msgType && rawQuoted[msgType] && typeof rawQuoted[msgType] === 'object') {
        delete rawQuoted[msgType].contextInfo
      }
      const quotedMessage = parseProtoMessage(rawQuoted)

      let participant = qm.participant ? cleanJid(qm.participant) : undefined
      if (qm.fromMe) {
        participant = targetJid.endsWith(JID_SUFFIX_LID) && sock.user?.lid 
          ? cleanJid(sock.user.lid) 
          : (sock.user?.id ? cleanJid(sock.user.id) : undefined)
      } else if (!targetJid.endsWith(JID_SUFFIX_GROUP)) {
        participant = targetJid
      }

      if (participant) {
        return {
          stanzaId: quotedMsgId,
          participant: cleanJid(participant),
          quotedMessage
        }
      }
    } catch (e) {
      console.error('[buildQuotedContextInfo] Failed to construct contextInfo:', e)
    }
    return undefined
  }

  private async cacheSentMediaFile(processed: ProcessedMessage, finalPathToSend: string): Promise<void> {
    const parsedContent = JSON.parse(processed.content)
    const unwrapped = unwrapMessage(parsedContent)
    const mediaType = 
      unwrapped.imageMessage ? 'image' :
      unwrapped.stickerMessage ? 'sticker' :
      unwrapped.videoMessage ? 'video' :
      unwrapped.documentMessage ? 'document' :
      unwrapped.audioMessage ? 'audio' : null

    const mediaMsg = unwrapped.imageMessage || unwrapped.stickerMessage || unwrapped.videoMessage || unwrapped.documentMessage || unwrapped.audioMessage

    if (mediaType && mediaMsg) {
      try {
        const mediaDir = this.fileStorage.getMediaDir()
        this.fileStorage.ensureDir(mediaDir)

        const fileName = this.messageParserService.getSafeMediaFileName(processed.id, mediaType, mediaMsg)
        const cachedFilePath = join(mediaDir, fileName)

        this.fileStorage.copyFile(finalPathToSend, cachedFilePath)

        ;(mediaMsg as MediaMessageWithLocalUri).localURI = `${APP_MEDIA_PREFIX}${fileName}`

        const updatedContent = JSON.stringify(parsedContent)
        await this.messageRepository.updateMessageContent(processed.id, updatedContent)

        processed.content = updatedContent
      } catch (err: unknown) {
        console.error('[MessageSenderService] Failed to cache sent media file:', err)
      }
    }
  }

  private getMediaTypeAndInitialContent(
    filePath: string,
    caption?: string,
    localUri?: string
  ): { messageType: string; content: string } {
    const lowerPath = filePath.toLowerCase()
    let typeKey = 'documentMessage'
    let msgType = 'documentMessage'

    if (lowerPath.endsWith('.webp')) {
      typeKey = 'stickerMessage'
      msgType = 'stickerMessage'
    } else if (['.mp4', '.mkv', '.avi', '.mov'].some(ext => lowerPath.endsWith(ext))) {
      typeKey = 'videoMessage'
      msgType = 'videoMessage'
    } else if (['.jpg', '.jpeg', '.png', '.gif'].some(ext => lowerPath.endsWith(ext))) {
      typeKey = 'imageMessage'
      msgType = 'imageMessage'
    } else if (['.ogg', '.opus', '.mp3', '.m4a'].some(ext => lowerPath.endsWith(ext))) {
      typeKey = 'audioMessage'
      msgType = 'audioMessage'
    }

    const payload: Record<string, unknown> = {}
    if (localUri) {
      payload.localURI = localUri
    }
    if (caption) {
      payload.caption = caption
    }
    if (typeKey === 'documentMessage') {
      payload.fileName = filePath.split(/[\\/]/).pop() || 'Document'
    }

    return {
      messageType: msgType,
      content: JSON.stringify({ [typeKey]: payload })
    }
  }

  async sendMessageWorkflow(
    sock: IMessageActionSocket,
    jid: string,
    text: string,
    quotedMsgId?: string,
    mentions?: string[]
  ): Promise<EnrichedMessage> {
    const targetJid = await this.contactService.resolveLidFromJid(jid)
    const contextInfo = quotedMsgId ? await this.buildQuotedContextInfo(quotedMsgId, targetJid, sock) : undefined

    const messageContent: Extract<AnyMessageContent, { text: string }> = { text }
    if (mentions && mentions.length > 0) messageContent.mentions = mentions
    if (contextInfo) messageContent.contextInfo = contextInfo

    const msgId = '3EB0' + randomBytes(8).toString('hex').toUpperCase()
    const timestamp = BigInt(Math.floor(Date.now() / 1000))

    const messageType = (mentions && mentions.length > 0) || contextInfo ? 'extendedTextMessage' : 'conversation'
    const content = JSON.stringify(
      messageType === 'conversation' 
        ? { conversation: text } 
        : { extendedTextMessage: messageContent }
    )

    const pendingMsg: ProcessedMessage = {
      id: msgId,
      chatJid: targetJid,
      fromMe: true,
      senderId: null,
      participant: null,
      timestamp,
      messageType,
      textContent: text,
      content,
      isDeleted: false,
      isEdited: false,
      status: 'PENDING'
    }

    await this.messageRepository.upsertMessage(pendingMsg)
    await this.chatService.updateTimestamp(targetJid, timestamp)

    const nameMap = await this.contactService.batchResolveNames([targetJid, ...(mentions || [])], sock)
    const enriched = await this.messageQueryService.enrichMessage(pendingMsg, sock, nameMap)

    this.getBus()?.emit('message:incoming', {
      chatJid: enriched.chatJid,
      senderJid: cleanJid(enriched.participant || enriched.chatJid),
      messageType: enriched.messageType,
      textContent: pendingMsg.textContent,
      fromMe: enriched.fromMe,
      timestamp: BigInt(enriched.timestamp),
      processed: pendingMsg,
      sock
    }).catch((err) => {
      console.error('[MessageSenderService] Failed to emit message:incoming event:', err)
    })

    sock.sendMessage(targetJid, messageContent, { messageId: msgId })
      .then(async (sentMsg) => {
        if (!sentMsg) {
          throw new Error('Failed to send message: empty response from socket')
        }
        const processed = await this.messageProcessingService.processMessage(sentMsg, sock)
        if (!processed || 'type' in processed) {
          throw new Error('Failed to process sent message')
        }
        const meJids = await this.contactService.getMeJids(sock)
        const isSelfChat = meJids.includes(targetJid)
        const status = isSelfChat ? 'READ' : 'SENT'

        await this.messageRepository.upsertMessage({
          ...processed,
          status
        })
        this.getBus()?.emit('message:status-updated', {
          id: msgId,
          chatJid: targetJid,
          status
        }).catch((err) => {
          console.error('[MessageSenderService] Failed to emit message:status-updated:', err)
        })
      })
      .catch((err: unknown) => {
        console.error('[MessageSenderService] Background send failed for message:', msgId, err)
      })

    return enriched
  }

  async sendMediaMessageWorkflow(
    sock: IMessageActionSocket,
    jid: string,
    filePath: string,
    caption?: string,
    quotedMsgId?: string,
    mentions?: string[]
  ): Promise<EnrichedMessage> {
    const targetJid = await this.contactService.resolveLidFromJid(jid)
    const contextInfo = quotedMsgId ? await this.buildQuotedContextInfo(quotedMsgId, targetJid, sock) : undefined

    const isAppUri = filePath.startsWith(APP_FAVOURITES_PREFIX) || filePath.startsWith(APP_MEDIA_PREFIX)
    let finalPathToSend = isAppUri ? this.fileStorage.resolveMediaPath(filePath) : filePath

    const msgId = '3EB0' + randomBytes(8).toString('hex').toUpperCase()
    const timestamp = BigInt(Math.floor(Date.now() / 1000))

    const mediaDir = this.fileStorage.getMediaDir()
    this.fileStorage.ensureDir(mediaDir)
    const ext = finalPathToSend.split('.').pop() || 'dat'
    const fileName = `${msgId}.${ext}`
    const cachedFilePath = join(mediaDir, fileName)

    let isTempFile = false
    const isSticker = finalPathToSend.toLowerCase().endsWith('.webp')
    
    if (isSticker && !isAppUri) {
      try {
        finalPathToSend = await stickerMetadataService.processAndAddMetadata(finalPathToSend)
        isTempFile = true
      } catch (err: unknown) {
        console.error('[MessageSenderService] Failed to process sticker metadata:', err)
      }
    }

    try {
      this.fileStorage.copyFile(finalPathToSend, cachedFilePath)
    } catch (err: unknown) {
      console.error('[MessageSenderService] Failed to copy media to cache:', err)
    }

    const localUri = `${APP_MEDIA_PREFIX}${fileName}`
    const { messageType, content } = this.getMediaTypeAndInitialContent(finalPathToSend, caption, localUri)

    const pendingMsg: ProcessedMessage = {
      id: msgId,
      chatJid: targetJid,
      fromMe: true,
      senderId: null,
      participant: null,
      timestamp,
      messageType,
      textContent: caption || null,
      content,
      isDeleted: false,
      isEdited: false,
      status: 'PENDING'
    }

    await this.messageRepository.upsertMessage(pendingMsg)
    await this.chatService.updateTimestamp(targetJid, timestamp)

    const nameMap = await this.contactService.batchResolveNames([targetJid, ...(mentions || [])], sock)
    const enriched = await this.messageQueryService.enrichMessage(pendingMsg, sock, nameMap)

    this.getBus()?.emit('message:incoming', {
      chatJid: enriched.chatJid,
      senderJid: cleanJid(enriched.participant || enriched.chatJid),
      messageType: enriched.messageType,
      textContent: pendingMsg.textContent,
      fromMe: enriched.fromMe,
      timestamp: BigInt(enriched.timestamp),
      processed: pendingMsg,
      sock
    }).catch((err) => {
      console.error('[MessageSenderService] Failed to emit message:incoming event:', err)
    })

    const executeBackgroundSend = async () => {
      try {
        const buffer = this.fileStorage.readFile(finalPathToSend)
        const sendOptions = getMediaSendOptions(finalPathToSend, buffer, caption)
        if (mentions && mentions.length > 0) sendOptions.mentions = mentions
        if (contextInfo) sendOptions.contextInfo = contextInfo

        const sentMsg = await sock.sendMessage(targetJid, sendOptions as unknown as AnyMessageContent, { messageId: msgId })
        if (!sentMsg) {
          throw new Error('Failed to send media message')
        }

        const processed = await this.messageProcessingService.processMessage(sentMsg, sock)
        if (!processed || 'type' in processed) {
          throw new Error('Failed to process sent message')
        }

        await this.cacheSentMediaFile(processed, finalPathToSend)

        const meJids = await this.contactService.getMeJids(sock)
        const isSelfChat = meJids.includes(targetJid)
        const status = isSelfChat ? 'READ' : 'SENT'

        await this.messageRepository.upsertMessage({
          ...processed,
          status
        })

        this.getBus()?.emit('message:status-updated', {
          id: msgId,
          chatJid: targetJid,
          status
        }).catch((err) => {
          console.error('[MessageSenderService] Failed to emit status update event:', err)
        })

      } catch (err) {
        console.error('[MessageSenderService] Background media send failed:', err)
      } finally {
        if (isTempFile) {
          try {
            this.fileStorage.deleteFile(finalPathToSend)
          } catch (e) {
            console.error('[MessageSenderService] Failed to delete temp file:', e)
          }
        }
      }
    }

    executeBackgroundSend().catch((err: unknown) => {
      console.error('[MessageSenderService] Background task promise failed:', err)
    })

    return enriched
  }
}
