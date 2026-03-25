import { prisma } from '../auth'
import { contactService } from './ContactService'
import { embeddingService } from './EmbeddingService'

export class MessageService {
  /**
   * Unwraps special message containers (ephemeral, view-once, document-with-caption).
   */
  unwrapMessage(msg: any): any {
    if (!msg) return {}
    let unwrapped = msg
    if (unwrapped.ephemeralMessage) unwrapped = unwrapped.ephemeralMessage.message || unwrapped.ephemeralMessage
    if (unwrapped.viewOnceMessage) unwrapped = unwrapped.viewOnceMessage.message || unwrapped.viewOnceMessage
    if (unwrapped.viewOnceMessageV2) unwrapped = unwrapped.viewOnceMessageV2.message || unwrapped.viewOnceMessageV2
    if (unwrapped.viewOnceMessageV2Extension) unwrapped = unwrapped.viewOnceMessageV2Extension.message || unwrapped.viewOnceMessageV2Extension
    if (unwrapped.documentWithCaptionMessage) unwrapped = unwrapped.documentWithCaptionMessage.message || unwrapped.documentWithCaptionMessage
    return unwrapped
  }

  /**
   * Parses a raw Baileys message object and prepares it for persistence.
   */
  async processMessage(msg: any, _sock: any): Promise<any> {
    const key = msg.key
    if (!key?.id) return null

    // 1. Unwrap and safely JSON-ify
    let rawMessage: any = null
    if (msg.message) {
      try {
        rawMessage = JSON.parse(JSON.stringify(msg.message))
      } catch (err) {
        // Safe stringify for potential circular deps or Proto-buffers
        const safeStringify = (obj: any) => JSON.stringify(obj, (_key, value) => {
          if (value && typeof value === 'object' && typeof value.toJSON === 'function') {
            try { return value.toJSON() } 
            catch (e) { 
              const copy: any = {}
              for (const k in value) { if (typeof value[k] !== 'function') copy[k] = value[k] }
              return copy
            }
          }
          return value
        })
        rawMessage = JSON.parse(safeStringify(msg.message))
      }
    }

    const remoteJid = key.remoteJid || ''
    const participant = key.participant || null

    // 2. Extract text content
    let textContent: string | null = null
    if (rawMessage) {
      const unwrapped = this.unwrapMessage(rawMessage)
      if (typeof unwrapped.conversation === 'string') {
        textContent = unwrapped.conversation
      } else if (unwrapped.extendedTextMessage?.text) {
        textContent = unwrapped.extendedTextMessage.text
      } else {
        const mediaMsg = unwrapped.imageMessage || unwrapped.videoMessage || unwrapped.documentMessage
        if (mediaMsg && typeof mediaMsg.caption === 'string') {
          textContent = mediaMsg.caption
        }
      }
    }

    // 3. Determine message type
    let messageType = 'unknown'
    if (rawMessage) {
      const typeKeys = [
        'conversation', 'extendedTextMessage', 'imageMessage',
        'videoMessage', 'audioMessage', 'documentMessage',
        'stickerMessage', 'contactMessage', 'locationMessage',
        'reactionMessage', 'protocolMessage'
      ]
      for (const k of typeKeys) {
        const unwrapped = this.unwrapMessage(rawMessage)
        if (unwrapped[k] !== undefined && unwrapped[k] !== null) {
          messageType = k
          break
        }
      }
    }

    // 4. Parse Timestamp
    const ts = msg.messageTimestamp ?? 0
    const timestamp = BigInt(
      typeof ts === 'object' && ts !== null && 'low' in (ts as Record<string, unknown>)
        ? ((ts as Record<string, unknown>).low as number)
        : (ts as number)
    )

    // 5. Ingest metadata (PushName, AltJID)
    if (msg.pushName) {
        const senderId = participant || remoteJid
        if (senderId) {
            contactService.upsertContact({ id: senderId, name: msg.pushName, notify: msg.pushName }, { overwriteName: false }).catch(() => {})
        }
    }

    const altJid = (key as any).participantAlt || (key as any).remoteJidAlt;
    if (altJid && typeof altJid === 'string' && altJid.includes('@s.whatsapp.net')) {
        const currentLid = participant?.includes('@lid') ? participant : (remoteJid?.includes('@lid') ? remoteJid : null);
        if (currentLid) {
            contactService.linkLidAndPn(currentLid, altJid).catch(() => {})
        }
    }

    // 6. Persist to DB
    if (messageType === 'reactionMessage') {
        const targetId = rawMessage.reactionMessage?.key?.id
        const emoji = rawMessage.reactionMessage?.text
        const senderId = participant || remoteJid
        
        if (targetId && senderId) {
            if (!emoji) {
                await (prisma as any).reaction.deleteMany({
                    where: { messageId: targetId, senderId }
                }).catch(() => {})
            } else {
                await (prisma as any).reaction.upsert({
                    where: { messageId_senderId: { messageId: targetId, senderId } },
                    update: { text: emoji, timestamp },
                    create: { messageId: targetId, remoteJid, senderId, text: emoji, timestamp }
                }).catch(() => {})
            }
        }
    } else {
        await prisma.message.upsert({
            where: { id: key.id },
            update: { textContent, messageType, content: JSON.stringify(rawMessage || {}), timestamp },
            create: { id: key.id, remoteJid, fromMe: key.fromMe === true, participant, timestamp, messageType, content: JSON.stringify(rawMessage || {}), textContent }
        })

        // Auto-index new text messages for semantic search (fire-and-forget)
        if (textContent && messageType !== 'reactionMessage') {
            embeddingService.indexMessage(key.id, textContent).catch(err => {
                console.error('[MessageService] real-time indexing failed:', err)
            })
        }
    }

    return {
        id: key.id,
        remoteJid,
        fromMe: key.fromMe === true,
        participant,
        timestamp,
        messageType,
        textContent,
        content: JSON.stringify(rawMessage || {})
    }
  }

  /**
   * Enriches a message object with contact names and other metadata for UI display.
   */
  async enrichMessage(msg: any, _sock: any, nameMap: Map<string, string>): Promise<any> {
    const senderId = msg.participant || msg.remoteJid
    const participantName = nameMap.get(senderId) || senderId.replace(/@.*$/, '')

    let finalContent: any = {}
    try { finalContent = JSON.parse(msg.content) } catch (e) {}

    const unwrapped = this.unwrapMessage(finalContent)
    const ctx = unwrapped?.extendedTextMessage?.contextInfo || unwrapped?.imageMessage?.contextInfo || unwrapped?.videoMessage?.contextInfo || unwrapped?.documentMessage?.contextInfo || unwrapped?.contextInfo

    if (ctx) {
        if (ctx.participant) {
            ctx.participantName = nameMap.get(ctx.participant) || ctx.participant.replace(/@.*$/, '')
        }
        if (ctx.mentionedJid && Array.isArray(ctx.mentionedJid)) {
            ctx.mentions = {}
            for (const jid of ctx.mentionedJid) {
                ctx.mentions[jid] = nameMap.get(jid) || jid.replace(/@.*$/, '')
            }
        }
        if (ctx.quotedMessage) {
            const q = this.unwrapMessage(ctx.quotedMessage)
            const qCtx = q?.extendedTextMessage?.contextInfo || q?.imageMessage?.contextInfo || q?.videoMessage?.contextInfo || q?.documentMessage?.contextInfo || q?.contextInfo
            if (qCtx && qCtx.mentionedJid && Array.isArray(qCtx.mentionedJid)) {
                qCtx.mentions = {}
                for (const jid of qCtx.mentionedJid) {
                    qCtx.mentions[jid] = nameMap.get(jid) || jid.replace(/@.*$/, '')
                }
            }
        }
    }

    return {
        ...msg,
        participantName,
        timestamp: msg.timestamp.toString(),
        content: JSON.stringify(finalContent)
    }
  }

  /**
   * Prepares send options for media or document messages based on file type.
   */
  getMediaSendOptions(filePath: string, buffer: Buffer, caption?: string): any {
    const lowerPath = filePath.toLowerCase()
    
    if (lowerPath.endsWith('.webp')) return { sticker: buffer }
    if (['.mp4', '.mkv', '.avi', '.mov'].some(ext => lowerPath.endsWith(ext))) return { video: buffer, caption }
    if (['.jpg', '.jpeg', '.png', '.gif'].some(ext => lowerPath.endsWith(ext))) return { image: buffer, caption }
    
    // Fallback to document message
    const ext = lowerPath.split('.').pop() || 'bin'
    const mimes: Record<string, string> = {
        'pdf': 'application/pdf',
        'doc': 'application/msword',
        'docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        'xls': 'application/vnd.ms-excel',
        'xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'ppt': 'application/vnd.ms-powerpoint',
        'pptx': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
        'txt': 'text/plain',
        'zip': 'application/zip',
        'rar': 'application/x-rar-compressed'
    }

    return { 
        document: buffer, 
        fileName: filePath.split(/[\\/]/).pop(),
        mimetype: mimes[ext] || 'application/octet-stream',
        caption
    }
  }

  /**
   * Resolves the correct file extension for a media/document message based on its metadata.
   */
  resolveExtension(mediaType: string, mediaMsg: any): string {
    if (mediaType === 'image') return 'jpg'
    if (mediaType === 'sticker') return 'webp'
    if (mediaType === 'video') return 'mp4'
    
    if (mediaType === 'document') {
        const mime = mediaMsg.mimetype || ''
        if (mime.includes('pdf')) return 'pdf'
        if (mime.includes('word')) return 'docx'
        if (mime.includes('sheet')) return 'xlsx'
        if (mime.includes('text')) return 'txt'
        
        const originalName = mediaMsg.fileName || ''
        if (originalName.includes('.')) return originalName.split('.').pop() || 'dat'
    }
    
    return 'dat'
  }

  /**
   * Generates a safe and descriptive filename for a media/document message.
   */
  getSafeMediaFileName(msgId: string, mediaType: string, mediaMsg: any): string {
    const ext = this.resolveExtension(mediaType, mediaMsg)
    
    if (mediaType === 'document' && mediaMsg.fileName) {
        const originalName = mediaMsg.fileName.includes('.') 
            ? mediaMsg.fileName.substring(0, mediaMsg.fileName.lastIndexOf('.'))
            : mediaMsg.fileName
        const safeName = originalName.replace(/[/\\?%*:|"<>]/g, '-').substring(0, 80)
        return `${safeName}_${msgId.substring(0, 8)}.${ext}`
    }
    
    return `${msgId}.${ext}`
  }
}

export const messageService = new MessageService()
