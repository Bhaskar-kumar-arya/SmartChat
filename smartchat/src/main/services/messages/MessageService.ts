import { prisma as globalPrisma } from '../../auth'
import { PrismaClient } from '@prisma/client'
import { ContactService, contactService as globalContactService } from '../contacts/ContactService'
import { EmbeddingService, embeddingService as globalEmbeddingService } from '../search/EmbeddingService'
import { mapBaileysStatus } from '../whatsapp/ReceiptService'
import { cleanJid } from '../../utils'

/**
 * Plain data object produced by parseMessageSync().
 * Contains everything needed for DB persistence, with zero side-effects during construction.
 */
export interface ParsedMessage {
  id: string
  chatJid: string
  fromMe: boolean
  participantString: string | null
  timestamp: bigint
  messageType: string
  rawMessage: any
  textContent: string | null
  pushName: string | null
  status?: string
}

export class MessageService {
  constructor(
    private prisma: PrismaClient,
    private contactService: ContactService,
    private embeddingService: EmbeddingService
  ) {}

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
   * Helper to dynamically determine the message type, with priority fallback.
   */
  getMessageType(unwrapped: any): string {
    if (!unwrapped) return 'unknown'

    // 1. Try our high-priority standard message types first
    const priorityKeys = [
      'conversation', 'extendedTextMessage', 'imageMessage',
      'videoMessage', 'audioMessage', 'documentMessage',
      'stickerMessage', 'contactMessage', 'locationMessage',
      'reactionMessage', 'protocolMessage', 'pollCreationMessage',
      'pollUpdateMessage', 'liveLocationMessage'
    ]

    for (const k of priorityKeys) {
      if (unwrapped[k] !== undefined && unwrapped[k] !== null) {
        return k
      }
    }

    // 2. Dynamic fallback: scan all keys, excluding technical keys
    const ignoredKeys = new Set(['contextInfo', 'messageContextInfo'])
    for (const k of Object.keys(unwrapped)) {
      if (!ignoredKeys.has(k) && unwrapped[k] !== undefined && unwrapped[k] !== null) {
        return k
      }
    }

    return 'unknown'
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

    const remoteJid = cleanJid(key.remoteJid || '')
    const participantString = key.participant ? cleanJid(key.participant) : (remoteJid.endsWith('@g.us') ? null : remoteJid)

    // 2. Extract text content & Unwrap
    let textContent: string | null = null
    const unwrapped = rawMessage ? this.unwrapMessage(rawMessage) : null
    
    if (unwrapped) {
      if (typeof unwrapped.conversation === 'string') {
        textContent = unwrapped.conversation
      } else if (unwrapped.extendedTextMessage?.text) {
        textContent = unwrapped.extendedTextMessage.text
      } else {
        const mediaMsg = unwrapped.imageMessage || unwrapped.videoMessage || unwrapped.documentMessage || unwrapped.audioMessage
        if (mediaMsg && typeof mediaMsg.caption === 'string') {
          textContent = mediaMsg.caption
        }
      }
    }

    // 3. Determine message type
    const messageType = unwrapped ? this.getMessageType(unwrapped) : 'unknown'

    // 4. Parse Timestamp
    const ts = msg.messageTimestamp ?? 0
    const timestamp = BigInt(
      typeof ts === 'object' && ts !== null && 'low' in (ts as Record<string, unknown>)
        ? ((ts as Record<string, unknown>).low as number)
        : (ts as number)
    )

    // 5. Ingest metadata (PushName, AltJID)
    if (msg.pushName && participantString) {
      await this.contactService.upsertContact({ id: participantString, name: msg.pushName, notify: msg.pushName }, { overwriteName: false }).catch(() => {})
    }

    // Opportunistic Identity Extraction (AddressingMode Aware)
    // We check all possible sender-related identifiers for any LID-PN pairs.
    const senderPrimary = participantString || remoteJid;
    const altJid = (key as any).participantAlt || (key as any).remoteJidAlt;
    const senderPn = (key as any).senderPn;

    const potentialIds = [senderPrimary, altJid, senderPn].filter(Boolean) as string[];
    let discoveredLid: string | null = null;
    let discoveredPn: string | null = null;

    for (const id of potentialIds) {
      if (typeof id === 'string') {
        if (id.includes('@lid')) discoveredLid = id;
        if (id.includes('@s.whatsapp.net')) discoveredPn = id;
      }
    }

    if (discoveredLid && discoveredPn) {
      await this.contactService.linkLidAndPn(discoveredLid, discoveredPn, 'message.upsert').catch(() => {});
    }

    // 6. Resolve Identity ID
    let senderId: number | null = null
    if (!key.fromMe && participantString) {
      senderId = await this.contactService.getIdentityIdByJid(participantString)
      if (!senderId) {
        await this.contactService.upsertContact({ id: participantString })
        senderId = await this.contactService.getIdentityIdByJid(participantString)
      }
    }

    // 7. Handle Protocol Messages (Revoke/Edit) separately before persisting
    if (messageType === 'protocolMessage' && unwrapped) {
        const protocol = unwrapped.protocolMessage
        const targetId = protocol?.key?.id
        if (targetId) {
            try {
                if (protocol.type === 0 || protocol.type === 'REVOKE') {
                    await this.prisma.message.update({
                        where: { id: targetId },
                        data: { isDeleted: true }
                    }).catch(() => {})
                    return { type: 'protocol', subType: 'revoke', targetId, key: protocol.key }
                } else if (protocol.type === 14 || protocol.type === 'MESSAGE_EDIT') {
                    const editedMsg = protocol.editedMessage
                    const editContent = editedMsg?.conversation || editedMsg?.extendedTextMessage?.text || (editedMsg?.imageMessage?.caption) || (editedMsg?.videoMessage?.caption) || null
                    
                    await this.prisma.message.update({
                        where: { id: targetId },
                        data: { 
                            content: JSON.stringify(editedMsg || {}), 
                            textContent: editContent,
                            isEdited: true 
                        }
                    }).catch(() => {})
                    return { type: 'protocol', subType: 'edit', targetId, key: protocol.key }
                }
            } catch (err) {
                console.error('[MessageService] Error handling protocol message:', err)
            }
        }
        return null // Don't save the protocol message itself
    }

    // Ensure chat exists
    const chatType = remoteJid.endsWith('@g.us') ? 'GROUP' : 'DM'
    await this.prisma.chat.upsert({
      where: { remoteJid },
      update: {},
      create: { jid: remoteJid, type: chatType }
    } as any).catch(() => {})

    // 8. Persist to DB
    if (messageType === 'reactionMessage') {
        const targetId = rawMessage.reactionMessage?.key?.id
        const emoji = rawMessage.reactionMessage?.text
        let reactorId = senderId

        if (key.fromMe) {
          // If fromMe, we need our own identity
          const meIdent = await this.prisma.identity.findFirst({ where: { isMe: true } })
          if (meIdent) reactorId = meIdent.id
        }

        if (targetId && reactorId) {
            if (!emoji) {
                await this.prisma.reaction.deleteMany({
                    where: { messageId: targetId, senderId: reactorId }
                }).catch(() => {})
            } else {
                await this.prisma.reaction.upsert({
                    where: { messageId_senderId: { messageId: targetId, senderId: reactorId } },
                    update: { text: emoji, timestamp },
                    create: { messageId: targetId, senderId: reactorId, text: emoji, timestamp }
                }).catch(() => {})
            }
        }
    } else {
        const status = mapBaileysStatus(msg.status)
        await this.prisma.message.upsert({
            where: { id: key.id },
            update: { textContent, messageType, content: JSON.stringify(rawMessage || {}), timestamp, senderId, participant: participantString, status },
            create: { 
              id: key.id, 
              chatJid: remoteJid, 
              fromMe: key.fromMe === true, 
              senderId, 
              participant: participantString,
              timestamp, 
              messageType, 
              content: JSON.stringify(rawMessage || {}), 
              textContent,
              status
            }
        })

        // Auto-index new text messages for semantic search (fire-and-forget)
        if (textContent && messageType !== 'reactionMessage') {
            this.embeddingService.indexMessage(key.id, textContent).catch(err => {
                console.error('[MessageService] real-time indexing failed:', err)
            })
        }
    }

    return {
        id: key.id,
        remoteJid,
        fromMe: key.fromMe === true,
        senderId,
        participant: participantString, // passing it up for UI/IPC enriched handling
        timestamp,
        messageType,
        textContent,
        content: JSON.stringify(rawMessage || {})
    }
  }

  /**
   * Synchronously parses a raw Baileys message into a plain data object (ParsedMessage).
   * Zero DB calls, zero side-effects — safe to call on large batches.
   * Returns null for messages that cannot or should not be bulk-persisted
   * (missing key, protocol/reaction messages which need per-message handling).
   */
  parseMessageSync(msg: any): ParsedMessage | null {
    const key = msg.key
    if (!key?.id) return null

    let rawMessage: any = null
    if (msg.message) {
      try {
        rawMessage = JSON.parse(JSON.stringify(msg.message))
      } catch {
        rawMessage = null
      }
    }

    const remoteJid = cleanJid(key.remoteJid || '')
    const participantString = key.participant ? cleanJid(key.participant) : (remoteJid.endsWith('@g.us') ? null : remoteJid)

    // Determine message type
    const unwrapped = rawMessage ? this.unwrapMessage(rawMessage) : null
    const messageType = unwrapped ? this.getMessageType(unwrapped) : 'unknown'

    // Protocol and reaction messages need special per-message handling — skip in bulk
    if (messageType === 'protocolMessage' || messageType === 'reactionMessage') return null

    // Extract text content
    let textContent: string | null = null
    if (unwrapped) {
      if (typeof unwrapped.conversation === 'string') {
        textContent = unwrapped.conversation
      } else if (unwrapped.extendedTextMessage?.text) {
        textContent = unwrapped.extendedTextMessage.text
      } else {
        const mediaMsg = unwrapped.imageMessage || unwrapped.videoMessage || unwrapped.documentMessage || unwrapped.audioMessage
        if (mediaMsg && typeof mediaMsg.caption === 'string') {
          textContent = mediaMsg.caption
        }
      }
    }

    // Parse timestamp
    const ts = msg.messageTimestamp ?? 0
    const timestamp = BigInt(
      typeof ts === 'object' && ts !== null && 'low' in (ts as Record<string, unknown>)
        ? ((ts as Record<string, unknown>).low as number)
        : (ts as number)
    )

    const status = mapBaileysStatus(msg.status)
    return {
      id: key.id,
      chatJid: remoteJid,
      fromMe: key.fromMe === true,
      participantString,
      timestamp,
      messageType,
      rawMessage,
      textContent,
      pushName: msg.pushName ?? null,
      status
    }
  }

  /**
   * Bulk-persists a batch of historical (append) messages efficiently.
   */
  async bulkPersistMessages(msgs: any[]): Promise<void> {
    if (msgs.length === 0) return

    // 1. Parse all (pure CPU — no DB)
    const parsed = msgs
      .map(m => this.parseMessageSync(m))
      .filter((p): p is ParsedMessage => p !== null)

    if (parsed.length === 0) return

    // 2. Ensure all referenced chats exist.
    const uniqueJids = Array.from(new Set(parsed.map(p => p.chatJid)))
    const existingChats = await this.prisma.chat.findMany({
      where: { jid: { in: uniqueJids } },
      select: { jid: true }
    })
    const existingChatJids = new Set(existingChats.map(c => c.jid))
    const newChats = uniqueJids
      .filter(jid => !existingChatJids.has(jid))
      .map(jid => ({ jid, type: jid.endsWith('@g.us') ? 'GROUP' : 'DM' }))
    if (newChats.length > 0) {
      await this.prisma.chat.createMany({ data: newChats }).catch(() => {})
    }

    // 3. Batch-resolve sender identity IDs
    const participantJids = Array.from(
      new Set(parsed.filter(p => !p.fromMe && p.participantString).map(p => p.participantString!))
    )
    const identityMap = await this.contactService.batchGetIdentityIds(participantJids)

    // 4. Build all candidate rows
    const allRows = parsed.map(p => ({
      id: p.id,
      chatJid: p.chatJid,
      fromMe: p.fromMe,
      senderId: p.fromMe ? null : (identityMap.get(p.participantString!) ?? null),
      participant: p.participantString,
      timestamp: p.timestamp,
      messageType: p.messageType,
      content: JSON.stringify(p.rawMessage || {}),
      textContent: p.textContent,
      status: p.status || 'SENT'
    }))

    // 5. Pre-fetch existing message IDs
    const allIds = allRows.map(r => r.id)
    const existingMsgs = await this.prisma.message.findMany({
      where: { id: { in: allIds } },
      select: { id: true }
    })
    const existingMsgIds = new Set(existingMsgs.map(m => m.id))
    const newRows = allRows.filter(r => !existingMsgIds.has(r.id))

    if (newRows.length > 0) {
      await this.prisma.message.createMany({ data: newRows })
    }

    console.log(`[MessageService] bulkPersistMessages: persisted ${newRows.length}/${allRows.length} messages (${allRows.length - newRows.length} already existed)`)
  }

  /**
   * Enrich a message object with contact names and other metadata for UI display.
   */
  async enrichMessage(msg: any, _sock: any, nameMap: Map<string, string>): Promise<any> {
    let participantName = 'Unknown'
    if (msg.fromMe) {
      participantName = 'Me'
    } else if (msg.sender) {
      participantName = ContactService.getDisplayName(msg.sender, 'Unknown')
    } else if (msg.participant) { // fallback
      participantName = nameMap.get(msg.participant) || msg.participant.replace(/@.*$/, '')
    }

    let finalContent: any = {}
    try { finalContent = JSON.parse(msg.content) } catch (e) {}

    const unwrapped = this.unwrapMessage(finalContent)
    const ctx = unwrapped?.extendedTextMessage?.contextInfo || unwrapped?.imageMessage?.contextInfo || unwrapped?.videoMessage?.contextInfo || unwrapped?.documentMessage?.contextInfo || unwrapped?.audioMessage?.contextInfo || unwrapped?.contextInfo

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
            const qCtx = q?.extendedTextMessage?.contextInfo || q?.imageMessage?.contextInfo || q?.videoMessage?.contextInfo || q?.documentMessage?.contextInfo || q?.audioMessage?.contextInfo || q?.contextInfo
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
    if (['.ogg', '.opus', '.mp3', '.m4a'].some(ext => lowerPath.endsWith(ext))) {
        const isPtt = lowerPath.endsWith('.ogg') || lowerPath.endsWith('.opus')
        return { 
          audio: buffer, 
          mimetype: isPtt ? 'audio/ogg; codecs=opus' : undefined,
          ptt: isPtt 
        }
    }
    
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
    if (mediaType === 'audio') return 'ogg'
    
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
   * Processes a real-time messages.reaction event update.
   */
  async processReaction(reactionUpdate: any, sock: any, mainWindow: any): Promise<void> {
    const targetId = reactionUpdate.key?.id
    const reactionKey = reactionUpdate.reaction?.key
    const text = reactionUpdate.reaction?.text
    const ts = reactionUpdate.reaction?.senderTimestampMs

    if (!targetId || !reactionKey) return

    // 1. Reconcile Linked ID (LID) and Phone Number (PN)
    const lid = reactionKey.participant || reactionKey.participantAlt
    const pn = reactionKey.participantAlt || reactionKey.participant

    let callLid: string | null = null
    let callPn: string | null = null
    const ids = [lid, pn].filter(Boolean) as string[]
    for (const id of ids) {
      if (typeof id === 'string') {
        if (id.includes('@lid')) callLid = id
        if (id.includes('@s.whatsapp.net')) callPn = id
      }
    }
    if (callLid && callPn) {
      await this.contactService.linkLidAndPn(callLid, callPn, 'messages.reaction').catch(() => {})
    }

    // 2. Parse reaction timestamp
    const timestamp = BigInt(
      typeof ts === 'object' && ts !== null && 'low' in (ts as Record<string, unknown>)
        ? ((ts as Record<string, unknown>).low as number)
        : (ts as number || Math.floor(Date.now() / 1000))
    )

    // 3. Resolve reactor JID and Identity ID
    const reactorJid = reactionKey.participant || (reactionKey.remoteJid?.endsWith('@g.us') ? null : reactionKey.remoteJid)
    let reactorId: number | null = null

    if (reactionKey.fromMe) {
      const meIdent = await this.prisma.identity.findFirst({ where: { isMe: true } })
      if (meIdent) {
        reactorId = meIdent.id
      } else {
        const myRawJid = sock?.user?.id
        const myJidClean = myRawJid ? myRawJid.split(':')[0] : null
        if (myJidClean) {
          reactorId = await this.contactService.getIdentityIdByJid(myJidClean)
          if (!reactorId) {
            const myLid = (sock?.user as any)?.lid?.split(':')[0]
            if (myLid) reactorId = await this.contactService.getIdentityIdByJid(myLid)
          }
        }
      }
    } else if (reactorJid) {
      reactorId = await this.contactService.getIdentityIdByJid(reactorJid)
      if (!reactorId) {
        await this.contactService.upsertContact({ id: reactorJid }).catch(() => {})
        reactorId = await this.contactService.getIdentityIdByJid(reactorJid)
      }
    }

    // 4. Update the DB reaction record
    if (reactorId) {
      if (!text) {
        await this.prisma.reaction.deleteMany({
          where: { messageId: targetId, senderId: reactorId }
        }).catch(() => {})
      } else {
        await this.prisma.reaction.upsert({
          where: { messageId_senderId: { messageId: targetId, senderId: reactorId } },
          update: { text, timestamp },
          create: { messageId: targetId, senderId: reactorId, text, timestamp }
        }).catch(() => {})
      }
    }

    // 5. Notify the frontend to update UI reactively
    if (mainWindow && !mainWindow.isDestroyed()) {
      const reactorJidString = reactorJid || (reactionKey.remoteJid || '')
      const nameMap = await this.contactService.batchResolveNames([reactorJidString], sock)
      const reactorName = nameMap.get(reactorJidString) || reactorJidString.replace(/@.*$/, '')

      const mockMsg = {
        id: reactionKey.id || targetId,
        remoteJid: reactionKey.remoteJid || '',
        fromMe: reactionKey.fromMe === true,
        senderId: reactorId,
        participant: reactorJidString,
        participantName: reactorName,
        timestamp: timestamp.toString(),
        messageType: 'reactionMessage',
        content: JSON.stringify({
          reactionMessage: {
            key: { id: targetId },
            text: text || ''
          }
        })
      }
      mainWindow.webContents.send('new-message', mockMsg)
    }
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

export const messageService = new MessageService(globalPrisma, globalContactService, globalEmbeddingService)
