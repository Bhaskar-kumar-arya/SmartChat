import { WAMessageStubType, proto } from '@whiskeysockets/baileys'
import { IContactNameResolver, IContactQueryService, ISocketUserContext } from '../contacts/IContactService'
import { IChatRepository } from '../chats/IChatRepository'
import { IMessageIndexer } from '../search/IEmbeddingService'
import { SecretMessageService } from '../whatsapp/secret/SecretMessageService'
import { cleanJid } from '../../utils/jidUtils'
import { parseBaileysTimestamp, unwrapMessage, getMessageType } from '../../utils/messageUtils'
import {
  BaileysMessage,
  ProtocolResult,
  BaileysReactionUpdate,
  WAMessageContent,
  WAMessageKey
} from '../whatsapp/types'
import { ProcessedMessage, DBMessageWithSender } from '../../domain/db.types'
import { EnrichedMessage } from '../../ipc/message.types'
import { IWAEventBus } from '../whatsapp/IWAEventBus'
import { getSafeMediaFileName as getSafeMediaFileNameHelper } from './MediaHelper'
import { MessageParser, ParsedMessage } from './MessageParser'
import { IMessageRepository } from './IMessageRepository'
import { IReactionRepository } from './IReactionRepository'
import { IMessageReadRepository } from './IMessageQueryRepository'
import { IMessageExistenceRepository } from './IMessageExistenceRepository'
import { MessageEnricher } from './MessageEnricher'
import { IMessageWriterService } from './IMessageWriterService'
import { IMessageQueryService } from './IMessageQueryService'
import { IMessageParserService } from './IMessageParserService'
import { IMessageProcessingService } from './IMessageProcessingService'
import { IMessageIdentityResolver } from './IMessageIdentityResolver'
import {
  IMessageProcessorStrategy,
  IMessageProcessingContext,
  IMessageServiceDependencyAccessor
} from './processors'

// Re-export ParsedMessage so existing consumers don't break
export type { ParsedMessage }

/**
 * MessageService — Application Service / Orchestrator.
 *
 * Coordinates the single-responsibility collaborators:
 *  - MessageParser:     pure parse/classify logic (no I/O)
 *  - MessageRepository: all Prisma read/write operations
 *  - MessageEnricher:   UI display-name resolution
 *  - IMessageIdentityResolver: all JID/identity mappings and linkings
 *
 * This class owns:
 *  - The high-level processing pipeline (processMessage, bulkPersistMessages)
 *  - Event-bus notifications
 */
export class MessageService implements IMessageWriterService, IMessageQueryService, IMessageParserService, IMessageProcessingService {
  constructor(
    private readonly contactService: IContactNameResolver & IContactQueryService,
    private readonly chatRepository: IChatRepository,
    private readonly embeddingService: IMessageIndexer,
    private readonly secretMessageService: SecretMessageService,
    private readonly getBus: () => IWAEventBus | null,
    private readonly parser: MessageParser,
    private readonly repository: IMessageRepository,
    private readonly queryRepository: IMessageReadRepository & IMessageExistenceRepository,
    private readonly reactionRepository: IReactionRepository,
    private readonly enricher: MessageEnricher,
    private readonly identityResolver: IMessageIdentityResolver,
    private readonly processors: IMessageProcessorStrategy[]
  ) {}

  // ─── Public API ─────────────────────────────────────────────────────────────

  /**
   * Processes a single incoming Baileys message: parses, resolves identity,
   * persists to DB, triggers semantic indexing, and returns a ProcessedMessage.
   */
  private async resolveSenderIdentity(
    key: proto.IMessageKey,
    baileysMsg: BaileysMessage,
    sock: ISocketUserContext
  ): Promise<{ participantString: string | null; senderId: number | null }> {
    const participantString = await this.identityResolver.resolveSenderJid(key, sock)

    // Side-effect: upsert contact for push name
    if (!key.fromMe && baileysMsg.pushName && participantString) {
      await this.identityResolver
        .upsertContactPushName(participantString, baileysMsg.pushName)
        .catch((err: unknown) => {
          console.error('[MessageService] Failed to upsert contact for pushName:', err)
        })
    }

    // Opportunistic LID↔PN identity extraction
    const remoteJid = cleanJid(key.remoteJid ?? '')
    const senderPrimary = participantString ?? remoteJid
    const keyRefined = key as unknown as { participantAlt?: string; remoteJidAlt?: string; senderPn?: string }
    const altJid = keyRefined.participantAlt ?? keyRefined.remoteJidAlt
    const senderPn = keyRefined.senderPn
    const potentialIds = [senderPrimary, altJid, senderPn].filter(Boolean) as string[]

    await this.identityResolver.reconcileLidPnFromJids(potentialIds, 'message.upsert')

    // Resolve sender identity ID
    let senderId: number | null = null
    if (!key.fromMe && participantString) {
      senderId = await this.identityResolver.resolveSenderId(participantString)
    }

    return { participantString, senderId }
  }

  private async dispatchProcessors(
    context: IMessageProcessingContext,
    dependencies: IMessageServiceDependencyAccessor
  ): Promise<ProcessedMessage | ProtocolResult | null> {
    // 1. Process messages that don't require ensuring chat exists (e.g. secret, protocol)
    for (const processor of this.processors) {
      if (processor.requiresChat === false && processor.supports(context)) {
        return processor.process(context, dependencies)
      }
    }

    // Ensure chat exists
    const chatType = context.remoteJid.endsWith('@g.us') ? 'GROUP' : 'DM'
    await this.chatRepository
      .upsertChat(context.remoteJid, { type: chatType })
      .catch((err: unknown) => {
        console.error('[MessageService] Failed to upsert chat:', err)
      })

    // 2. Process messages that require ensuring chat exists (e.g. reaction, standard)
    for (const processor of this.processors) {
      if (processor.requiresChat !== false && processor.supports(context)) {
        return processor.process(context, dependencies)
      }
    }

    return null
  }

  async processMessage(msg: unknown, sock: ISocketUserContext | null): Promise<ProcessedMessage | ProtocolResult | null> {
    if (!sock) return null
    const baileysMsg = msg as BaileysMessage

    const key = baileysMsg.key
    if (!key?.id) return null

    const remoteJid = cleanJid(key.remoteJid ?? '')
    const rawMessage = this.parser['_safeSerialize'](baileysMsg.message)

    const { participantString, senderId } = await this.resolveSenderIdentity(key, baileysMsg, sock)

    // Extract text content
    const unwrapped = rawMessage ? unwrapMessage(rawMessage) : null
    const textContent = this.parser.extractTextContent(unwrapped)

    // Determine message type
    let messageType = unwrapped ? getMessageType(unwrapped) : 'unknown'

    if (messageType === 'senderKeyDistributionMessage') return null

    let finalTextContent = textContent
    let rawMsgCopy = rawMessage
    if (baileysMsg.messageStubType === WAMessageStubType.CIPHERTEXT) {
      messageType = 'ciphertext'
      finalTextContent = 'Waiting for this message. This may take a while.'
    } else if (baileysMsg.messageStubType !== undefined && baileysMsg.messageStubType !== null && baileysMsg.messageStubType !== WAMessageStubType.REVOKE) {
      messageType = 'system'
      rawMsgCopy = {
        stubType: typeof baileysMsg.messageStubType === 'number'
          ? (WAMessageStubType[baileysMsg.messageStubType] || 'UNKNOWN')
          : String(baileysMsg.messageStubType),
        parameters: baileysMsg.messageStubParameters || []
      }
    }

    const timestamp = parseBaileysTimestamp(baileysMsg.messageTimestamp ?? 0)

    const context: IMessageProcessingContext = {
      msg: baileysMsg,
      sock,
      rawMessage: rawMsgCopy,
      unwrapped,
      remoteJid,
      participantString,
      senderId,
      timestamp,
      messageType,
      textContent: finalTextContent
    }

    const dependencies: IMessageServiceDependencyAccessor = {
      identityRepository: this.identityResolver.identityRepository,
      repository: this.repository,
      reactionRepository: this.reactionRepository,
      embeddingService: this.embeddingService,
      secretMessageService: this.secretMessageService,
      contactService: this.contactService
    }

    return this.dispatchProcessors(context, dependencies)
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
   * Updates a message's content when decrypted.
   */
  async decryptMessageInDb(
    messageId: string,
    messageType: string,
    textContent: string | null,
    content: Record<string, unknown>
  ): Promise<void> {
    await this.repository.decryptMessage(messageId, messageType, textContent, content)
  }

  /**
   * Returns true for message types that require special per-message handling.
   */
  isSpecialMessage(msg: unknown): boolean {
    return this.parser.isSpecialMessage(msg as BaileysMessage)
  }

  /**
   * Synchronously parses a raw Baileys message into a plain data object.
   * Zero DB calls, zero side-effects — safe to call on large batches.
   */
  parseMessageSync(msg: unknown): ParsedMessage | null {
    return this.parser.parseMessageSync(msg as BaileysMessage)
  }

  /**
   * Bulk-persists a batch of historical messages efficiently.
   */
  async bulkPersistMessages(msgs: unknown[]): Promise<void> {
    const baileysMsgs = msgs as BaileysMessage[]
    if (baileysMsgs.length === 0) return

    const parsed = baileysMsgs
      .map(m => this.parser.parseMessageSync(m))
      .filter((p): p is ParsedMessage => p !== null)

    if (parsed.length === 0) return

    // Ensure all referenced chats exist
    const uniqueJids = Array.from(new Set(parsed.map(p => p.chatJid)))
    const existingChats = await this.chatRepository.findChatsByJids(uniqueJids)
    const existingChatJids = new Set(existingChats.map(c => c.jid))
    const newChats = uniqueJids
      .filter(jid => !existingChatJids.has(jid))
      .map(jid => ({ jid, type: jid.endsWith('@g.us') ? 'GROUP' : 'DM' }))
    if (newChats.length > 0) {
      await this.chatRepository.bulkCreateChats(newChats)
    }

    // Batch-resolve sender identity IDs
    const participantJids = Array.from(
      new Set(parsed.filter(p => !p.fromMe && p.participantString).map(p => p.participantString!))
    )
    const identityMap = await this.contactService.batchGetIdentityIds(participantJids)

    const meJids = await this.contactService.getMeJids()
    const allRows = parsed.map(p => {
      const senderId = p.fromMe ? null : (identityMap.get(p.participantString!) ?? null)
      const row = this.parser.toDbRow(p, senderId)
      if (meJids.includes(p.chatJid)) {
        row.status = 'READ'
      }
      return row
    })

    const existingIds = await this.queryRepository.findExistingIds(allRows.map(r => r.id))
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
  private collectAdditionalJidsForResolve(messages: DBMessageWithSender[]): Set<string> {
    const additionalJids = new Set<string>()
    messages.forEach(m => {
      try {
        const content = JSON.parse(m.content)
        if (m.messageType === 'system') {
          const params = content.parameters
          if (Array.isArray(params)) {
            const isJid = (val: string) => typeof val === 'string' && (val.includes('@s.whatsapp.net') || val.includes('@lid') || val.includes('@g.us'))
            params.forEach(param => {
              const paramStr = String(param)
              if (isJid(paramStr)) {
                additionalJids.add(paramStr)
              } else if (paramStr.trim().startsWith('{')) {
                try {
                  const parsed = JSON.parse(paramStr) as Record<string, unknown>
                  if (typeof parsed.phoneNumber === 'string' && isJid(parsed.phoneNumber)) {
                    additionalJids.add(parsed.phoneNumber)
                  }
                  if (typeof parsed.id === 'string' && isJid(parsed.id)) {
                    additionalJids.add(parsed.id)
                  }
                } catch (err: unknown) {
                  console.warn(`[MessageService] Failed to parse system parameter as JSON:`, err)
                }
              }
            })
          }
          if (m.participant) {
            additionalJids.add(m.participant)
          }
          return
        }
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
            const q = unwrapMessage(ctx.quotedMessage as WAMessageContent)
            const qRaw = q as Record<string, unknown>
            const qCtx = (
              (qRaw?.extendedTextMessage as Record<string, unknown> | undefined)?.contextInfo ??
              (qRaw?.contextInfo as Record<string, unknown> | undefined)
            ) as Record<string, unknown> | undefined
            if (qCtx?.mentionedJid)
              (qCtx.mentionedJid as string[]).forEach(j => additionalJids.add(j))
          }
        }
      } catch (err: unknown) {
        // Non-fatal: malformed content
        console.warn(`[MessageService] Failed to parse message content for JID extraction:`, err)
      }
    })
    return additionalJids
  }

  /**
   * Retrieves messages for a chat with enriched display names and reactions.
   */
  async getChatMessages(
    jid: string,
    page: number = 1,
    pageSize: number = 50,
    sock: unknown | null = null,
    resolveLid: boolean = false,
    includeReactions: boolean = true
  ): Promise<EnrichedMessage[]> {
    const targetJid = resolveLid ? await this.contactService.resolveLidFromJid(jid) : jid
    const skip = (page - 1) * pageSize

    const messages = await this.queryRepository.findChatMessagesWithSender(targetJid, skip, pageSize)
    const additionalJids = this.collectAdditionalJidsForResolve(messages)

    const nameMap = await this.contactService.batchResolveNames(
      Array.from(additionalJids),
      sock as ISocketUserContext | null
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
      allReactions = await this.reactionRepository.findReactionsForMessages(messageIds)
    }

    const enriched = await Promise.all(
      messages.map(async m => {
        const enrichedMsg = await this.enricher.enrichMessage(m, sock as ISocketUserContext | null, nameMap)
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
    sock: unknown | null,
    nameMap: Map<string, string>
  ): Promise<EnrichedMessage> {
    return this.enricher.enrichMessage(msg, sock as ISocketUserContext | null, nameMap)
  }

  /**
   * Enrich a single message by performing batch resolution of names first.
   */
  async enrichSingleMessage(
    msg: DBMessageWithSender,
    sock: unknown | null
  ): Promise<EnrichedMessage> {
    const additionalJids = this.collectAdditionalJidsForResolve([msg])
    const participantOrChat = cleanJid(msg.participant || msg.chatJid)
    additionalJids.add(participantOrChat)

    const nameMap = await this.contactService.batchResolveNames(
      Array.from(additionalJids),
      sock as ISocketUserContext | null
    )
    return this.enricher.enrichMessage(msg, sock as ISocketUserContext | null, nameMap)
  }

  /**
   * Efficiently fetch all messages from `messageId` to the newest, plus
   * `lookBehind` messages before it for context. Falls back to page-1 on error.
   */
  async getMessagesAroundId(
    jid: string,
    messageId: string,
    lookBehind: number = 20,
    sock: unknown | null = null
  ): Promise<EnrichedMessage[]> {
    // Step 1: get the target message's timestamp
    const target = await this.queryRepository.findMessageById(messageId)
    if (!target) {
      console.warn(`[MessageService] getMessagesAroundId: message ${messageId} not found, falling back`)
      return this.getChatMessages(jid, 1, 50, sock)
    }

    try {
      const messages = await this.queryRepository.findMessagesFromTimestamp(
        jid,
        target.timestamp,
        lookBehind
      )

      const additionalJids = this.collectAdditionalJidsForResolve(messages)
      const nameMap = await this.contactService.batchResolveNames(
        Array.from(additionalJids),
        sock as ISocketUserContext | null
      )

      const messageIds = messages.map(m => m.id)
      const allReactions = messageIds.length > 0
        ? await this.reactionRepository.findReactionsForMessages(messageIds)
        : []

      const enriched = await Promise.all(
        messages.map(async m => {
          const enrichedMsg = await this.enricher.enrichMessage(m, sock as ISocketUserContext | null, nameMap)
          const msgReactions = allReactions.filter(r => r.messageId === m.id)
          return { ...enrichedMsg, reactions: this.enricher.enrichReactions(msgReactions) }
        })
      )
      return enriched
    } catch (err) {
      console.error('[MessageService] getMessagesAroundId failed, falling back:', err)
      return this.getChatMessages(jid, 1, 50, sock)
    }
  }

  private async reconcileLidPnForReaction(reactionKey: WAMessageKey): Promise<void> {
    const refinedKey = reactionKey as WAMessageKey & { participantAlt?: string }
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
      await this.identityResolver.linkLidAndPn(callLid, callPn, 'messages.reaction').catch((err: unknown) => {
        console.warn('[MessageService] Failed to link Lid and Pn for reaction:', err)
      })
    }
  }

  private async resolveReactorIdForReaction(
    reactionKey: WAMessageKey,
    reactorJid: string | null,
    sock: ISocketUserContext | null
  ): Promise<number | null> {
    if (reactionKey.fromMe) {
      return this.identityResolver.resolveMeSenderId(sock)
    }
    if (reactorJid) {
      return this.identityResolver.resolveSenderId(reactorJid)
    }
    return null
  }

  /**
   * Process an incoming reaction update event.
   */
  async processReaction(
    reactionUpdate: unknown,
    sock: unknown | null
  ): Promise<void> {
    const update = reactionUpdate as BaileysReactionUpdate
    const targetId = update.key?.id
    const reactionKey = update.reaction?.key
    const text = update.reaction?.text
    const ts = update.reaction?.senderTimestampMs

    if (!targetId || !reactionKey) return

    await this.reconcileLidPnForReaction(reactionKey)

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
    const reactorJid = await this.identityResolver.resolveReactorJid(reactionKey, sock as ISocketUserContext | null)
    const reactorId = await this.resolveReactorIdForReaction(reactionKey, reactorJid, sock as ISocketUserContext | null)

    // Persist via repository
    if (reactorId) {
      await this.reactionRepository.upsertReaction(targetId, reactorId, text ?? null, timestamp)
    }

    // Fetch target message for enriched event payload
    const targetMsg = await this.queryRepository.findMessageTypeAndContent(targetId)

    // Notify frontend via event bus
    const reactorJidString = reactorJid ?? reactionKey.remoteJid ?? ''
    const nameMap = await this.contactService.batchResolveNames([reactorJidString], sock as ISocketUserContext | null)
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
    return getSafeMediaFileNameHelper(msgId, mediaType, mediaMsg)
  }
}
