import { PrismaClient } from '@prisma/client'
import { ContactService } from '../contacts/ContactService'
import { EmbeddingService } from '../search/EmbeddingService'
import { mapBaileysStatus } from '../whatsapp/ReceiptService'
import { cleanJid, parseBaileysTimestamp, getMessageType, unwrapMessage } from '../../utils'
import { BrowserWindow } from 'electron'
import { WASocket, BaileysMessage, ProcessedMessage, ProtocolResult, DBMessageWithSender, MediaSendOptions, EnrichedMessage, BaileysReactionUpdate } from '../../types'

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
   * Parses a raw Baileys message object and prepares it for persistence.
   */
  async processMessage(msg: BaileysMessage, _sock: WASocket | null): Promise<ProcessedMessage | ProtocolResult | null> {
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
    let participantString = key.participant ? cleanJid(key.participant) : (remoteJid.endsWith('@g.us') ? null : remoteJid)
    if (key.fromMe) {
      if (_sock?.user) {
        const myJid = _sock.user.id || ''
        const myLid = (_sock.user as { lid?: string })?.lid || ''
        participantString = myLid ? myLid.split(':')[0] + '@lid' : (myJid ? myJid.split(':')[0] + '@s.whatsapp.net' : participantString)
      } else {
        const meIdent = await this.prisma.identity.findFirst({ where: { isMe: true } })
        if (meIdent?.phoneNumber) {
          participantString = meIdent.phoneNumber
        }
      }
    }

    // 2. Extract text content & Unwrap
    let textContent: string | null = null
    const unwrapped = rawMessage ? unwrapMessage(rawMessage) : null
    
    if (unwrapped) {
      if (typeof unwrapped.conversation === 'string') {
        textContent = unwrapped.conversation
      } else if (unwrapped.extendedTextMessage?.text) {
        textContent = unwrapped.extendedTextMessage.text
      } else {
        const mediaMsg = unwrapped.imageMessage || unwrapped.videoMessage || unwrapped.documentMessage || unwrapped.audioMessage || unwrapped.ptvMessage
        if (mediaMsg && typeof mediaMsg.caption === 'string') {
          textContent = mediaMsg.caption
        }
      }
    }

    // 3. Determine message type
    const messageType = unwrapped ? getMessageType(unwrapped) : 'unknown'

    // 4. Parse Timestamp
    const timestamp = parseBaileysTimestamp(msg.messageTimestamp ?? 0)

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
        // Try to preserve existing localURI if message already exists
        const existing = await this.prisma.message.findUnique({
          where: { id: key.id },
          select: { content: true }
        })
        if (existing && existing.content && rawMessage) {
          try {
            const existingContent = JSON.parse(existing.content)
            const existingUnwrapped = unwrapMessage(existingContent)
            const existingMediaMsg = existingUnwrapped?.imageMessage || existingUnwrapped?.stickerMessage || existingUnwrapped?.videoMessage || existingUnwrapped?.documentMessage || existingUnwrapped?.audioMessage
            
            if (existingMediaMsg && existingMediaMsg.localURI) {
              const currentUnwrapped = unwrapMessage(rawMessage)
              const currentMediaMsg = currentUnwrapped?.imageMessage || currentUnwrapped?.stickerMessage || currentUnwrapped?.videoMessage || currentUnwrapped?.documentMessage || currentUnwrapped?.audioMessage
              if (currentMediaMsg) {
                currentMediaMsg.localURI = existingMediaMsg.localURI
              }
            }
          } catch (e) {
            console.error('[MessageService] Failed to preserve localURI on upsert:', e)
          }
        }

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
        chatJid: remoteJid,
        fromMe: key.fromMe === true,
        senderId,
        participant: participantString, // passing it up for UI/IPC enriched handling
        timestamp,
        messageType,
        textContent,
        content: JSON.stringify(rawMessage || {}),
        isDeleted: false,
        isEdited: false,
        status: mapBaileysStatus(msg.status)
    }
  }

  /**
   * Synchronously parses a raw Baileys message into a plain data object (ParsedMessage).
   * Zero DB calls, zero side-effects — safe to call on large batches.
   * Returns null for messages that cannot or should not be bulk-persisted
   * (missing key, protocol/reaction messages which need per-message handling).
   */
  parseMessageSync(msg: BaileysMessage): ParsedMessage | null {
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
    const unwrapped = rawMessage ? unwrapMessage(rawMessage) : null
    const messageType = unwrapped ? getMessageType(unwrapped) : 'unknown'

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
        const mediaMsg = unwrapped.imageMessage || unwrapped.videoMessage || unwrapped.documentMessage || unwrapped.audioMessage || unwrapped.ptvMessage
        if (mediaMsg && typeof mediaMsg.caption === 'string') {
          textContent = mediaMsg.caption
        }
      }
    }

    // Parse timestamp
    const timestamp = parseBaileysTimestamp(msg.messageTimestamp ?? 0)

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
  async bulkPersistMessages(msgs: BaileysMessage[]): Promise<void> {
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
   * Retrieves messages for a chat, resolves mentions and reactions, and returns enriched records.
   */
  async getChatMessages(
    jid: string,
    page: number = 1,
    pageSize: number = 50,
    sock: WASocket | null,
    resolveLid: boolean = false,
    includeReactions: boolean = true
  ): Promise<EnrichedMessage[]> {
    const targetJid = resolveLid ? await this.contactService.resolveLidFromJid(jid) : jid
    const skip = (page - 1) * pageSize

    const messages = await this.prisma.message.findMany({
      where: { chatJid: targetJid },
      orderBy: { timestamp: 'desc' },
      skip,
      take: pageSize,
      include: { sender: true }
    })

    // We still need to parse contextInfo for mentions
    const additionalJids = new Set<string>()
    messages.forEach(m => {
      try {
        const content = JSON.parse(m.content)
        const unwrapped = unwrapMessage(content)
        const ctx = unwrapped?.extendedTextMessage?.contextInfo || unwrapped?.contextInfo
        if (ctx) {
          if (ctx.participant) additionalJids.add(ctx.participant)
          if (ctx.mentionedJid) ctx.mentionedJid.forEach((j: string) => additionalJids.add(j))
          if (ctx.quotedMessage) {
            const q = unwrapMessage(ctx.quotedMessage)
            const qCtx = q?.extendedTextMessage?.contextInfo || q?.contextInfo
            if (qCtx && qCtx.mentionedJid) qCtx.mentionedJid.forEach((j: string) => additionalJids.add(j))
          }
        }
      } catch (e) {}
    })

    const nameMap = await this.contactService.batchResolveNames(Array.from(additionalJids), sock)

    let allReactions: any[] = []
    if (includeReactions && messages.length > 0) {
      const messageIds = messages.map((m) => m.id)
      allReactions = await this.prisma.reaction.findMany({
        where: { messageId: { in: messageIds } },
        include: { sender: true }
      })
    }

    const messagesWithNames = await Promise.all(
      messages.map(async (m) => {
        const enriched = await this.enrichMessage(m, sock, nameMap)
        if (!includeReactions) {
          return enriched
        }
        const msgReactions = allReactions.filter((r) => r.messageId === m.id)
        
        return {
          ...enriched,
          reactions: msgReactions.map((r) => ({ 
            ...r, 
            senderId: r.sender.phoneNumber || '',
            timestamp: r.timestamp.toString(),
            senderName: r.sender.displayName || r.sender.pushName || r.sender.phoneNumber?.split('@')[0] || 'Unknown'
          }))
        }
      })
    )

    return messagesWithNames.reverse()
  }

  /**
   * Enrich a message object with contact names and other metadata for UI display.
   */
  async enrichMessage(msg: DBMessageWithSender, _sock: WASocket | null, nameMap: Map<string, string>): Promise<EnrichedMessage> {
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

    const unwrapped = unwrapMessage(finalContent)
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
            const q = unwrapMessage(ctx.quotedMessage)
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
  getMediaSendOptions(filePath: string, buffer: Buffer, caption?: string): MediaSendOptions {
    const lowerPath = filePath.toLowerCase()
    
    if (lowerPath.endsWith('.webp')) return { sticker: buffer }
    if (['.mp4', '.mkv', '.avi', '.mov'].some(ext => lowerPath.endsWith(ext))) {
      const isGifPlayback = lowerPath.includes('gifplayback') || lowerPath.includes('giphy')
      return { video: buffer, caption, gifPlayback: isGifPlayback ? true : undefined }
    }
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
  async processReaction(reactionUpdate: BaileysReactionUpdate, sock: WASocket | null, mainWindow: BrowserWindow | null): Promise<void> {
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
    const timestamp = parseBaileysTimestamp(
      typeof ts === 'object' && ts !== null && 'low' in (ts as Record<string, unknown>)
        ? ts
        : (ts || Math.floor(Date.now() / 1000))
    )

    // 3. Resolve reactor JID and Identity ID
    let reactorJid = reactionKey.participant || (reactionKey.remoteJid?.endsWith('@g.us') ? null : reactionKey.remoteJid)
    if (reactionKey.fromMe) {
      if (sock?.user) {
        const myRawJid = sock.user.id || ''
        const myLid = (sock.user as any)?.lid || ''
        reactorJid = myLid ? myLid.split(':')[0] + '@lid' : (myRawJid ? myRawJid.split(':')[0] + '@s.whatsapp.net' : reactorJid)
      } else {
        const meIdent = await this.prisma.identity.findFirst({ where: { isMe: true } })
        if (meIdent?.phoneNumber) {
          reactorJid = meIdent.phoneNumber
        }
      }
    }

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
        chatJid: cleanJid(reactionKey.remoteJid || ''),
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
    
    // Attempt to resolve fileSha256 hash for deduplication
    let fileHash: string | null = null
    if (mediaMsg && mediaMsg.fileSha256) {
      const sha = mediaMsg.fileSha256
      if (typeof sha === 'string') {
        fileHash = sha.replace(/[/\\?%*:|"<>+]/g, '-').substring(0, 64)
      } else if (Buffer.isBuffer(sha)) {
        fileHash = sha.toString('hex')
      } else if (sha && typeof sha === 'object' && sha.type === 'Buffer' && Array.isArray(sha.data)) {
        fileHash = Buffer.from(sha.data).toString('hex')
      } else if (sha instanceof Uint8Array || Array.isArray(sha)) {
        fileHash = Buffer.from(sha).toString('hex')
      }
    }

    if (mediaType === 'document' && mediaMsg.fileName) {
        const originalName = mediaMsg.fileName.includes('.') 
            ? mediaMsg.fileName.substring(0, mediaMsg.fileName.lastIndexOf('.'))
            : mediaMsg.fileName
        const safeName = originalName.replace(/[/\\?%*:|"<>]/g, '-').substring(0, 80)
        const suffix = fileHash ? fileHash.substring(0, 12) : msgId.substring(0, 8)
        return `${safeName}_${suffix}.${ext}`
    }
    
    if (fileHash) {
      return `hash_${fileHash}.${ext}`
    }
    
    return `${msgId}.${ext}`
  }
}
