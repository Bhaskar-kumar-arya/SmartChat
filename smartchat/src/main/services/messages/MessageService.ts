import { PrismaClient } from '@prisma/client'
import { WAMessageStubType, proto } from '@whiskeysockets/baileys'
import { ContactService } from '../contacts/ContactService'
import { EmbeddingService } from '../search/EmbeddingService'
import { SecretMessageService } from '../whatsapp/secret/SecretMessageService'
import { mapBaileysStatus } from '../whatsapp/ReceiptService'
import { cleanJid, parseBaileysTimestamp, unwrapMessage } from '../../utils'
import {
  WASocket,
  BaileysMessage,
  ProcessedMessage,
  ProtocolResult,
  DBMessageWithSender,
  EnrichedMessage,
  BaileysReactionUpdate
} from '../../types'
import { WAEventBus } from '../whatsapp/WAEventBus'
import { resolveExtension } from './MediaHelper'
import { MessageParser, ParsedMessage } from './MessageParser'
import { MessageRepository } from './MessageRepository'
import { MessageEnricher } from './MessageEnricher'

// Re-export ParsedMessage so existing consumers don't break
export type { ParsedMessage }

/**
 * MessageService — Application Service / Orchestrator.
 *
 * Coordinates the three single-responsibility collaborators:
 *  - MessageParser:     pure parse/classify logic (no I/O)
 *  - MessageRepository: all Prisma read/write operations
 *  - MessageEnricher:   UI display-name resolution
 *
 * This class owns:
 *  - The high-level processing pipeline (processMessage, bulkPersistMessages)
 *  - Identity side-effects (contact upserts, LID↔PN linking)
 *  - Event-bus notifications
 */
export class MessageService {
  private readonly parser: MessageParser
  private readonly repository: MessageRepository
  private readonly enricher: MessageEnricher

  constructor(
    private readonly prisma: PrismaClient,
    private readonly contactService: ContactService,
    private readonly embeddingService: EmbeddingService,
    private readonly secretMessageService: SecretMessageService,
    private readonly getBus: () => WAEventBus | null
  ) {
    this.parser = new MessageParser()
    this.repository = new MessageRepository(prisma)
    this.enricher = new MessageEnricher(contactService)
  }

  // ─── Public API ─────────────────────────────────────────────────────────────

  /**
   * Processes a single incoming Baileys message: parses, resolves identity,
   * persists to DB, triggers semantic indexing, and returns a ProcessedMessage.
   */
  async processMessage(
    msg: BaileysMessage,
    _sock: WASocket | null
  ): Promise<ProcessedMessage | ProtocolResult | null> {
    const key = msg.key
    if (!key?.id) return null

    // Route secret/encrypted messages to their dedicated handler
    if (msg.message?.secretEncryptedMessage || msg.message?.encReactionMessage) {
      return this.secretMessageService.handleSecretMessage(msg, _sock)
    }

    const rawMessage = this.parser['_safeSerialize'](msg.message)

    const remoteJid = cleanJid(key.remoteJid ?? '')
    let participantString = key.participant
      ? cleanJid(key.participant)
      : remoteJid.endsWith('@g.us')
      ? null
      : remoteJid

    // Resolve "me" participant JID
    if (key.fromMe) {
      if (_sock?.user) {
        const myJid = _sock.user.id ?? ''
        const myLid = (_sock.user as { lid?: string })?.lid ?? ''
        participantString = myLid
          ? myLid.split(':')[0] + '@lid'
          : myJid
          ? myJid.split(':')[0] + '@s.whatsapp.net'
          : participantString
      } else {
        const meIdent = await this.prisma.identity.findFirst({ where: { isMe: true } })
        if (meIdent?.phoneNumber) {
          participantString = meIdent.phoneNumber
        }
      }
    }

    // Extract text content
    const unwrapped = rawMessage ? unwrapMessage(rawMessage) : null
    const textContent = this.parser.extractTextContent(unwrapped)

    // Determine message type
    const messageType = unwrapped
      ? (unwrapped
          ? Object.keys(unwrapped).find(k => k !== 'messageContextInfo') ?? 'unknown'
          : 'unknown')
      : 'unknown'

    const timestamp = parseBaileysTimestamp(msg.messageTimestamp ?? 0)

    // Side-effect: upsert contact for push name
    if (!key.fromMe && msg.pushName && participantString) {
      await this.contactService
        .upsertContact(
          { id: participantString, name: msg.pushName, notify: msg.pushName },
          { overwriteName: false }
        )
        .catch((err: unknown) => {
          console.error('[MessageService] Failed to upsert contact for pushName:', err)
        })
    }

    // Opportunistic LID↔PN identity extraction
    const senderPrimary = participantString ?? remoteJid
    const keyRefined = key as unknown as { participantAlt?: string; remoteJidAlt?: string; senderPn?: string }
    const altJid = keyRefined.participantAlt ?? keyRefined.remoteJidAlt
    const senderPn = keyRefined.senderPn
    const potentialIds = [senderPrimary, altJid, senderPn].filter(Boolean) as string[]

    let discoveredLid: string | null = null
    let discoveredPn: string | null = null
    for (const id of potentialIds) {
      if (typeof id === 'string') {
        if (id.includes('@lid')) discoveredLid = id
        if (id.includes('@s.whatsapp.net')) discoveredPn = id
      }
    }
    if (discoveredLid && discoveredPn) {
      await this.contactService
        .linkLidAndPn(discoveredLid, discoveredPn, 'message.upsert')
        .catch((err: unknown) => {
          console.error('[MessageService] Failed to link LID and PN:', err)
        })
    }

    // Resolve sender identity ID
    let senderId: number | null = null
    if (!key.fromMe && participantString) {
      senderId = await this.contactService.getIdentityIdByJid(participantString)
      if (!senderId) {
        await this.contactService.upsertContact({ id: participantString })
        senderId = await this.contactService.getIdentityIdByJid(participantString)
      }
    }

    // Route protocol messages (revoke / edit) without persisting them
    if (messageType === 'protocolMessage' && unwrapped) {
      const protocol = unwrapped.protocolMessage as Record<string, unknown> | undefined
      const targetId = (protocol?.key as { id?: string } | undefined)?.id
      if (targetId && protocol) {
        try {
          const type = protocol.type
          if (type === 0 || type === 'REVOKE') {
            return {
              type: 'protocol',
              subType: 'revoke',
              targetId,
              chatJid: remoteJid,
              key: protocol.key as import('@whiskeysockets/baileys').proto.IMessageKey
            }
          } else if (type === 14 || type === 'MESSAGE_EDIT') {
            const editedMsg = protocol.editedMessage as Record<string, unknown> | undefined
            const editContent =
              (editedMsg?.conversation as string | undefined) ??
              ((editedMsg?.extendedTextMessage as Record<string, unknown> | undefined)?.text as string | undefined) ??
              ((editedMsg?.imageMessage as Record<string, unknown> | undefined)?.caption as string | undefined) ??
              ((editedMsg?.videoMessage as Record<string, unknown> | undefined)?.caption as string | undefined) ??
              null
            return {
              type: 'protocol',
              subType: 'edit',
              targetId,
              chatJid: remoteJid,
              key: protocol.key as import('@whiskeysockets/baileys').proto.IMessageKey,
              editedTextContent: editContent,
              editedContent: editedMsg as import('@whiskeysockets/baileys').proto.IMessage | null
            }
          }
        } catch (err: unknown) {
          console.error('[MessageService] Error handling protocol message:', err)
        }
      }
      return null
    }

    // Ensure chat exists
    const chatType = remoteJid.endsWith('@g.us') ? 'GROUP' : 'DM'
    await this.prisma.chat
      .upsert({
        where: { jid: remoteJid },
        update: {},
        create: { jid: remoteJid, type: chatType }
      } as unknown as { where: { jid: string }; update: Record<string, unknown>; create: { jid: string; type: 'GROUP' | 'DM' } })
      .catch((err: unknown) => {
        console.error('[MessageService] Failed to upsert chat:', err)
      })

    // Handle reaction messages via repository
    if (messageType === 'reactionMessage' && rawMessage) {
      const reactionMsg = rawMessage.reactionMessage as Record<string, unknown> | undefined
      const targetId = (reactionMsg?.key as { id?: string } | undefined)?.id
      const emoji = reactionMsg?.text as string | undefined

      let reactorId = senderId
      if (key.fromMe) {
        const meIdent = await this.prisma.identity.findFirst({ where: { isMe: true } })
        if (meIdent) reactorId = meIdent.id
      }

      if (targetId && reactorId !== null) {
        await this.repository.upsertReaction(targetId, reactorId, emoji ?? null, timestamp)
      }
    } else {
      // Standard message persistence
      const isDeleted =
        msg.messageStubType === WAMessageStubType.REVOKE ||
        (msg.messageStubType === WAMessageStubType.CIPHERTEXT &&
          msg.messageStubParameters?.includes('Message absent from node'))
      const status = mapBaileysStatus(msg.status)

      await this.repository.upsertMessage({
        id: key.id,
        chatJid: remoteJid,
        fromMe: key.fromMe === true,
        senderId,
        participant: participantString,
        timestamp,
        messageType,
        content: JSON.stringify(rawMessage ?? {}),
        textContent,
        status: status ?? null,
        isDeleted: isDeleted ?? false
      })

      // Fire-and-forget semantic search indexing
      if (textContent && messageType !== 'reactionMessage') {
        this.embeddingService.indexMessage(key.id, textContent).catch((err: unknown) => {
          console.error('[MessageService] real-time indexing failed:', err)
        })
      }
    }

    const isDeleted =
      msg.messageStubType === WAMessageStubType.REVOKE ||
      (msg.messageStubType === WAMessageStubType.CIPHERTEXT &&
        (msg.messageStubParameters?.includes('Message absent from node') ?? false))

    return {
      id: key.id,
      chatJid: remoteJid,
      fromMe: key.fromMe === true,
      senderId,
      participant: participantString,
      timestamp,
      messageType,
      textContent,
      content: JSON.stringify(rawMessage ?? {}),
      isDeleted,
      isEdited: false,
      status: mapBaileysStatus(msg.status)
    }
  }

  /**
   * Marks a message as deleted in the database.
   */
  async revokeMessageInDb(messageId: string): Promise<void> {
    await this.repository.revokeMessage(messageId)
  }

  /**
   * Updates a message's content and marks it as edited in the database.
   */
  async editMessageInDb(
    messageId: string,
    textContent: string | null,
    editedContent: Record<string, unknown> | null
  ): Promise<void> {
    await this.repository.editMessage(messageId, textContent, editedContent)
  }

  /**
   * Returns true for message types that require special per-message handling.
   */
  isSpecialMessage(msg: BaileysMessage): boolean {
    return this.parser.isSpecialMessage(msg)
  }

  /**
   * Synchronously parses a raw Baileys message into a plain data object.
   * Zero DB calls, zero side-effects — safe to call on large batches.
   */
  parseMessageSync(msg: BaileysMessage): ParsedMessage | null {
    return this.parser.parseMessageSync(msg)
  }

  /**
   * Bulk-persists a batch of historical messages efficiently.
   */
  async bulkPersistMessages(msgs: BaileysMessage[]): Promise<void> {
    if (msgs.length === 0) return

    const parsed = msgs
      .map(m => this.parser.parseMessageSync(m))
      .filter((p): p is ParsedMessage => p !== null)

    if (parsed.length === 0) return

    // Ensure all referenced chats exist
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
      await this.prisma.chat.createMany({ data: newChats }).catch((err: unknown) => {
        console.warn('[MessageService] Failed to pre-create missing chats in bulk:', err)
      })
    }

    // Batch-resolve sender identity IDs
    const participantJids = Array.from(
      new Set(parsed.filter(p => !p.fromMe && p.participantString).map(p => p.participantString!))
    )
    const identityMap = await this.contactService.batchGetIdentityIds(participantJids)

    const allRows = parsed.map(p => ({
      id: p.id,
      chatJid: p.chatJid,
      fromMe: p.fromMe,
      senderId: p.fromMe ? null : (identityMap.get(p.participantString!) ?? null),
      participant: p.participantString,
      timestamp: p.timestamp,
      messageType: p.messageType,
      content: JSON.stringify(p.rawMessage ?? {}),
      textContent: p.textContent,
      status: p.status ?? 'SENT',
      isDeleted: p.isDeleted ?? false
    }))

    const existingIds = await this.repository.findExistingIds(allRows.map(r => r.id))
    const newRows = allRows.filter(r => !existingIds.has(r.id))

    if (newRows.length > 0) {
      await this.repository.bulkCreateMessages(newRows)
    }

    console.log(
      `[MessageService] bulkPersistMessages: persisted ${newRows.length}/${allRows.length} messages`
    )
  }

  /**
   * Retrieves messages for a chat with enriched display names and reactions.
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

    // Collect JIDs needed for name resolution
    const additionalJids = new Set<string>()
    messages.forEach(m => {
      try {
        const content = JSON.parse(m.content)
        const unwrapped = unwrapMessage(content)
        const unwrappedRaw = unwrapped as Record<string, unknown>
        const ctx = (
          (unwrappedRaw?.extendedTextMessage as Record<string, unknown> | undefined)?.contextInfo ??
          (unwrappedRaw?.contextInfo as Record<string, unknown> | undefined)
        ) as Record<string, unknown> | undefined
        if (ctx) {
          if (ctx.participant) additionalJids.add(ctx.participant as string)
          if (ctx.mentionedJid)
            (ctx.mentionedJid as string[]).forEach(j => additionalJids.add(j))
          if (ctx.quotedMessage) {
            const q = unwrapMessage(ctx.quotedMessage as proto.IMessage)
            const qRaw = q as Record<string, unknown>
            const qCtx = (
              (qRaw?.extendedTextMessage as Record<string, unknown> | undefined)?.contextInfo ??
              (qRaw?.contextInfo as Record<string, unknown> | undefined)
            ) as Record<string, unknown> | undefined
            if (qCtx?.mentionedJid)
              (qCtx.mentionedJid as string[]).forEach(j => additionalJids.add(j))
          }
        }
      } catch {
        // Non-fatal: malformed content
      }
    })

    const nameMap = await this.contactService.batchResolveNames(
      Array.from(additionalJids),
      sock
    )

    let allReactions: Array<{
      messageId: string
      text: string
      timestamp: bigint
      senderId: number
      sender: { displayName?: string | null; pushName?: string | null; phoneNumber?: string | null }
    }> = []
    if (includeReactions && messages.length > 0) {
      const messageIds = messages.map(m => m.id)
      allReactions = await this.prisma.reaction.findMany({
        where: { messageId: { in: messageIds } },
        include: { sender: true }
      })
    }

    const enriched = await Promise.all(
      messages.map(async m => {
        const enrichedMsg = await this.enricher.enrichMessage(m, sock, nameMap)
        if (!includeReactions) return enrichedMsg
        const msgReactions = allReactions.filter(r => r.messageId === m.id)
        return {
          ...enrichedMsg,
          reactions: this.enricher.enrichReactions(msgReactions)
        }
      })
    )

    return enriched.reverse()
  }

  /**
   * Enrich a single message for UI display. Delegates to MessageEnricher.
   */
  async enrichMessage(
    msg: DBMessageWithSender,
    sock: WASocket | null,
    nameMap: Map<string, string>
  ): Promise<EnrichedMessage> {
    return this.enricher.enrichMessage(msg, sock, nameMap)
  }

  /**
   * Process an incoming reaction update event.
   */
  async processReaction(
    reactionUpdate: BaileysReactionUpdate,
    sock: WASocket | null
  ): Promise<void> {
    const targetId = reactionUpdate.key?.id
    const reactionKey = reactionUpdate.reaction?.key
    const text = reactionUpdate.reaction?.text
    const ts = reactionUpdate.reaction?.senderTimestampMs

    if (!targetId || !reactionKey) return

    // LID ↔ PN reconciliation
    const refinedKey = reactionKey as import('@whiskeysockets/baileys').proto.IMessageKey & { participantAlt?: string }
    const lid = refinedKey.participant ?? refinedKey.participantAlt
    const pn = refinedKey.participantAlt ?? refinedKey.participant

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
      await this.contactService.linkLidAndPn(callLid, callPn, 'messages.reaction').catch((err: unknown) => {
        console.warn('[MessageService] Failed to link Lid and Pn for reaction:', err)
      })
    }

    // Parse reaction timestamp
    let timestamp = parseBaileysTimestamp(
      typeof ts === 'object' && ts !== null && 'low' in (ts as Record<string, unknown>)
        ? ts
        : ts ?? Math.floor(Date.now() / 1000)
    )
    if (timestamp > 9999999999n) {
      timestamp = timestamp / 1000n
    }

    // Resolve reactor JID
    let reactorJid: string | null | undefined =
      refinedKey.participant ??
      (refinedKey.remoteJid?.endsWith('@g.us') ? null : refinedKey.remoteJid)
    if (refinedKey.fromMe) {
      if (sock?.user) {
        const myRawJid = sock.user.id ?? ''
        const myLid = (sock.user as unknown as { lid?: string })?.lid ?? ''
        reactorJid = myLid
          ? myLid.split(':')[0] + '@lid'
          : myRawJid
          ? myRawJid.split(':')[0] + '@s.whatsapp.net'
          : reactorJid
      } else {
        const meIdent = await this.prisma.identity.findFirst({ where: { isMe: true } })
        if (meIdent?.phoneNumber) reactorJid = meIdent.phoneNumber
      }
    }

    // Resolve reactor identity ID
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
            const myLid = (sock?.user as unknown as { lid?: string })?.lid?.split(':')[0]
            if (myLid) reactorId = await this.contactService.getIdentityIdByJid(myLid)
          }
        }
      }
    } else if (reactorJid) {
      reactorId = await this.contactService.getIdentityIdByJid(reactorJid)
      if (!reactorId) {
        await this.contactService.upsertContact({ id: reactorJid }).catch((err: unknown) => {
          console.error('[MessageService] Failed to upsert reactor contact:', err)
        })
        reactorId = await this.contactService.getIdentityIdByJid(reactorJid)
      }
    }

    // Persist via repository
    if (reactorId) {
      await this.repository.upsertReaction(targetId, reactorId, text ?? null, timestamp)
    }

    // Fetch target message for enriched event payload
    const targetMsg = await this.prisma.message.findUnique({
      where: { id: targetId },
      select: { messageType: true, textContent: true }
    })

    // Notify frontend via event bus
    const reactorJidString = reactorJid ?? reactionKey.remoteJid ?? ''
    const nameMap = await this.contactService.batchResolveNames([reactorJidString], sock)
    const reactorName = nameMap.get(reactorJidString) ?? reactorJidString.replace(/@.*$/, '')

    await this.getBus()?.emit('reaction:processed', {
      id: reactionKey.id ?? targetId,
      chatJid: cleanJid(reactionKey.remoteJid ?? ''),
      remoteJid: reactionKey.remoteJid ?? '',
      fromMe: reactionKey.fromMe === true,
      senderId: reactorId,
      participant: reactorJidString,
      participantName: reactorName,
      timestamp: timestamp.toString(),
      messageType: 'reactionMessage',
      targetMessageType: targetMsg?.messageType,
      targetTextContent: targetMsg?.textContent,
      content: JSON.stringify({
        reactionMessage: { key: { id: targetId }, text: text ?? '' },
        targetMessage: targetMsg
          ? { messageType: targetMsg.messageType, textContent: targetMsg.textContent }
          : null
      })
    })
  }

  /**
   * Build a safe, deduplication-friendly filename for a downloaded media file.
   */
  getSafeMediaFileName(msgId: string, mediaType: string, mediaMsg: unknown): string {
    const ext = resolveExtension(mediaType, mediaMsg)

    let fileHash: string | null = null
    const mediaObj = mediaMsg as Record<string, unknown> | null | undefined
    if (mediaObj?.fileSha256) {
      const sha = mediaObj.fileSha256
      if (typeof sha === 'string') {
        fileHash = sha.replace(/[/\\?%*:|"<>+]/g, '-').substring(0, 64)
      } else if (Buffer.isBuffer(sha)) {
        fileHash = sha.toString('hex')
      } else if (
        sha &&
        typeof sha === 'object' &&
        'type' in sha &&
        (sha as { type: unknown }).type === 'Buffer' &&
        'data' in sha &&
        Array.isArray((sha as { data: unknown }).data)
      ) {
        fileHash = Buffer.from((sha as { data: number[] }).data).toString('hex')
      } else if (sha instanceof Uint8Array || Array.isArray(sha)) {
        fileHash = Buffer.from(sha as Uint8Array).toString('hex')
      }
    }

    if (mediaType === 'document' && mediaObj && typeof mediaObj.fileName === 'string') {
      const originalName = mediaObj.fileName.includes('.')
        ? mediaObj.fileName.substring(0, mediaObj.fileName.lastIndexOf('.'))
        : mediaObj.fileName
      const safeName = originalName.replace(/[/\\?%*:|"<>]/g, '-').substring(0, 80)
      const suffix = fileHash ? fileHash.substring(0, 12) : msgId.substring(0, 8)
      return `${safeName}_${suffix}.${ext}`
    }

    if (fileHash) return `hash_${fileHash}.${ext}`
    return `${msgId}.${ext}`
  }
}
