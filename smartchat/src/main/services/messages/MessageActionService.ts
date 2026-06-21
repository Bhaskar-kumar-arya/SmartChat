import { IContactNameResolver, IContactQueryService } from '../contacts/IContactService'
import { IIdentityRepository } from '../contacts/IIdentityRepository'
import { join } from 'path'
import { IMessageProcessingService } from './IMessageProcessingService'
import { IMessageParserService } from './IMessageParserService'
import { IMessageQueryService } from './IMessageQueryService'
import { IMessageWriteRepository } from './IMessageRepository'
import { IMessageCompoundRepository } from './IMessageCompoundRepository'
import { IReactionRepository } from './IReactionRepository'
import { IMessageReadRepository } from './IMessageQueryRepository'
import { IChatService } from '../chats/IChatService'
import { AnyMessageContent } from '@whiskeysockets/baileys'
import { MediaMessageWithLocalUri, WAMessageContent, WAContextInfo, parseProtoMessage } from '../whatsapp/types'
import { EnrichedMessage } from '../../ipc/message.types'
import { cleanJid } from '../../utils/jidUtils'
import { unwrapMessage } from '../../utils/messageUtils'
import type { IWAEventBus } from '../whatsapp/IWAEventBus'
import { stickerMetadataService } from './StickerMetadataService'
import { getMediaSendOptions } from './MediaHelper'
import { LocalFileStorage } from '../storage/LocalFileStorage'
import { IMessageActionService, IMessageActionSocket } from './IMessageActionService'
import { ProcessedMessage } from '../../domain/db.types'


const JID_SUFFIX_GROUP = '@g.us'
const JID_SUFFIX_LID = '@lid'
const APP_FAVOURITES_PREFIX = 'app://favourites/'
const APP_MEDIA_PREFIX = 'app://media/'

/**
 * Service for orchestrating message action workflows (delete, edit, forward, react, send).
 *
 * Error handling contract:
 * - Methods throw Error on any logical, network, or validation failures.
 */
export class MessageActionService implements IMessageActionService {
  private readonly fileStorage: LocalFileStorage

  constructor(
    private readonly messageRepository: IMessageWriteRepository & IMessageCompoundRepository,
    private readonly reactionRepository: IReactionRepository,
    private readonly messageQueryRepository: IMessageReadRepository,
    private readonly identityRepository: IIdentityRepository,
    private readonly contactService: IContactNameResolver & IContactQueryService,
    private readonly messageProcessingService: IMessageProcessingService,
    private readonly messageParserService: IMessageParserService,
    private readonly messageQueryService: IMessageQueryService,
    private readonly chatService: IChatService,
    private readonly getBus: () => IWAEventBus | null,
    fileStorage?: LocalFileStorage
  ) {
    // Allow injection for testing; default to concrete adapter for production
    this.fileStorage = fileStorage ?? new LocalFileStorage()
  }

  /**
   * Deletes (revokes) a message.
   */
  async deleteMessage(sock: IMessageActionSocket, messageId: string, jid?: string): Promise<{ success: boolean; detail: string; messageId: string }> {
    let targetJid = jid;
    const dbMsg = await this.messageQueryRepository.findMessageById(messageId);
    if (!dbMsg) {
      throw new Error(`Message with ID ${messageId} not found in database`);
    }

    if (!targetJid) {
      targetJid = dbMsg.chatJid;
    }
    const resolvedJid = await this.contactService.resolveLidFromJid(targetJid);

    const msgKey = {
      remoteJid: dbMsg.chatJid,
      fromMe: dbMsg.fromMe,
      id: messageId,
      participant: dbMsg.chatJid.endsWith(JID_SUFFIX_GROUP) ? (dbMsg.participant || undefined) : undefined
    };

    await sock.sendMessage(resolvedJid, { delete: msgKey });

    await this.messageRepository.updateMessageDeleted(messageId);

    this.getBus()?.emit('message:deleted', {
      messageId,
      chatJid: dbMsg.chatJid,
      fromMe: dbMsg.fromMe
    }).catch((err) => {
      console.error('[MessageActionService] Failed to emit message:deleted event:', err)
    });

    return {
      success: true,
      detail: `Message ${messageId} deleted successfully in chat ${resolvedJid}`,
      messageId
    };
  }

  private getUpdatedEditContent(contentJson: string, newText: string): string {
    const updatedContent = JSON.parse(contentJson || '{}');
    if (updatedContent.conversation !== undefined) {
      updatedContent.conversation = newText;
    } else if (updatedContent.extendedTextMessage) {
      updatedContent.extendedTextMessage.text = newText;
    } else if (updatedContent.imageMessage) {
      updatedContent.imageMessage.caption = newText;
    } else if (updatedContent.videoMessage) {
      updatedContent.videoMessage.caption = newText;
    } else if (updatedContent.documentMessage) {
      updatedContent.documentMessage.caption = newText;
    } else {
      updatedContent.conversation = newText;
    }
    return JSON.stringify(updatedContent);
  }

  /**
   * Edits the text content of a message.
   */
  async editMessage(sock: IMessageActionSocket, messageId: string, newText: string, jid?: string): Promise<EnrichedMessage> {
    let targetJid = jid;
    const dbMsg = await this.messageQueryRepository.findMessageWithSender(messageId);
    if (!dbMsg) {
      throw new Error(`Message with ID ${messageId} not found in database`);
    }

    if (!targetJid) {
      targetJid = dbMsg.chatJid;
    }
    const resolvedJid = await this.contactService.resolveLidFromJid(targetJid);

    const msgKey = {
      remoteJid: dbMsg.chatJid,
      fromMe: dbMsg.fromMe,
      id: messageId,
      participant: dbMsg.chatJid.endsWith(JID_SUFFIX_GROUP) ? (dbMsg.participant || undefined) : undefined
    };

    const result = await sock.sendMessage(resolvedJid, {
      text: newText,
      edit: msgKey
    });

    if (!result) throw new Error('Failed to edit message via WhatsApp socket');

    const updatedContentJson = this.getUpdatedEditContent(dbMsg.content || '{}', newText);

    const updated = await this.messageRepository.updateAndFetchMessageWithSender(
      messageId, newText, updatedContentJson
    )
    if (!updated) throw new Error('Failed to fetch updated message after edit')

    const nameMap = await this.contactService.batchResolveNames([updated.participant || resolvedJid], sock);
    const enriched = await this.messageQueryService.enrichMessage(updated, sock, nameMap);

    this.getBus()?.emit('message:edited', {
      messageId,
      chatJid: enriched.chatJid,
      editedTextContent: newText,
      editedContent: JSON.parse(updatedContentJson) as WAMessageContent,
      sock
    }).catch((err) => {
      console.error('[MessageActionService] Failed to emit message:edited event:', err)
    });

    return enriched;
  }

  private async forwardToDestination(
    sock: IMessageActionSocket,
    messageId: string,
    waMessage: any,
    destJid: string
  ): Promise<{ jid: string; messageId: string }> {
    const resolvedDest = await this.contactService.resolveLidFromJid(destJid);
    const sentMsg = await sock.sendMessage(resolvedDest, { forward: waMessage });
    if (!sentMsg) {
      throw new Error(`Failed to forward message ${messageId} to ${resolvedDest}`);
    }

    const processed = await this.messageProcessingService.processMessage(sentMsg, sock);
    if (!processed || 'type' in processed) {
      throw new Error('Failed to process forwarded message');
    }
    await this.chatService.updateTimestamp(resolvedDest, processed.timestamp);

    const nameMap = await this.contactService.batchResolveNames(
      [processed.participant || resolvedDest],
      sock
    );
    const enriched = await this.messageQueryService.enrichMessage(processed, sock, nameMap);
    this.getBus()?.emit('message:incoming', {
      chatJid: enriched.chatJid,
      senderJid: cleanJid(enriched.participant || enriched.chatJid),
      messageType: enriched.messageType,
      textContent: processed.textContent,
      fromMe: enriched.fromMe,
      timestamp: BigInt(enriched.timestamp),
      processed: processed,
      sock
    }).catch((err) => {
      console.error('[MessageActionService] Failed to emit message:incoming event:', err);
    });

    return {
      jid: resolvedDest,
      messageId: processed.id
    };
  }

  private getForwardDestinations(targetJids: string[], jid?: string): string[] {
    if (targetJids && Array.isArray(targetJids) && targetJids.length > 0) {
      return targetJids;
    }
    if (jid) {
      return [jid];
    }
    throw new Error('Missing destination for forwarding: targetJids or jid must be specified');
  }

  /**
   * Forwards a message to one or more destination JIDs/LIDs.
   */
  async forwardMessage(sock: IMessageActionSocket, messageId: string, targetJids: string[], jid?: string): Promise<{ success: boolean; detail: string; results: Array<{ jid: string; messageId: string }> }> {
    const dbMsg = await this.messageQueryRepository.findMessageById(messageId);
    if (!dbMsg) {
      throw new Error(`Message with ID ${messageId} not found in database`);
    }

    const rawMessage = JSON.parse(dbMsg.content || '{}');

    const waMessage = {
      key: {
        remoteJid: dbMsg.chatJid,
        fromMe: dbMsg.fromMe,
        id: dbMsg.id,
        participant: dbMsg.participant || undefined
      },
      message: parseProtoMessage(rawMessage),
      messageTimestamp: Number(dbMsg.timestamp)
    };

    const destinations = this.getForwardDestinations(targetJids, jid);
    const results: { jid: string; messageId: string }[] = [];
    for (const destJid of destinations) {
      const res = await this.forwardToDestination(sock, messageId, waMessage, destJid);
      results.push(res);
    }

    return {
      success: true,
      detail: `Message ${messageId} successfully forwarded to ${destinations.length} destination(s)`,
      results
    };
  }

  private async resolveReactorId(sock: IMessageActionSocket): Promise<number> {
    const meIdent = await this.identityRepository.findMeIdentity();
    if (meIdent) return meIdent.id;

    const myRawJid = sock?.user?.id;
    const myJidClean = myRawJid ? myRawJid.split(':')[0] : null;
    if (myJidClean) {
      const reactorId = await this.contactService.getIdentityIdByJid(myJidClean);
      if (reactorId) return reactorId;

      const myLid = (sock?.user as unknown as { lid?: string })?.lid?.split(':')[0];
      if (myLid) {
        const reactorIdByLid = await this.contactService.getIdentityIdByJid(myLid);
        if (reactorIdByLid) return reactorIdByLid;
      }
    }
    throw new Error('Failed to resolve logged-in user identity to record the reaction');
  }

  private async updateReactionDb(messageId: string, reactorId: number, reaction: string): Promise<void> {
    const timestamp = BigInt(Math.floor(Date.now() / 1000));
    if (!reaction) {
      await this.reactionRepository.deleteReactions(messageId, reactorId);
    } else {
      await this.reactionRepository.upsertReaction(messageId, reactorId, reaction, timestamp);
    }
  }

  /**
   * Reacts to a message with an emoji, or removes the reaction.
   */
  async reactToMessage(sock: IMessageActionSocket, messageId: string, reaction: string, jid?: string): Promise<{ success: boolean; detail: string; messageId: string; reaction: string }> {
    let targetJid = jid;
    const dbMsg = await this.messageQueryRepository.findMessageById(messageId);
    if (!dbMsg) {
      throw new Error(`Message with ID ${messageId} not found in database`);
    }

    if (!targetJid) {
      targetJid = dbMsg.chatJid;
    }
    const resolvedJid = await this.contactService.resolveLidFromJid(targetJid);

    const msgKey = {
      remoteJid: dbMsg.chatJid,
      fromMe: dbMsg.fromMe,
      id: messageId,
      participant: dbMsg.chatJid.endsWith(JID_SUFFIX_GROUP) ? (dbMsg.participant || undefined) : undefined
    };

    // Send the reaction message via WhatsApp
    const result = await sock.sendMessage(resolvedJid, {
      react: {
        text: reaction, // Empty string removes/revokes the reaction
        key: msgKey
      }
    });

    if (!result) throw new Error('Failed to send reaction via WhatsApp socket');

    const reactorId = await this.resolveReactorId(sock);
    await this.updateReactionDb(messageId, reactorId, reaction);

    return {
      success: true,
      detail: reaction 
        ? `Reacted to message ${messageId} with emoji "${reaction}"`
        : `Removed reaction from message ${messageId}`,
      messageId,
      reaction
    };
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

  /**
   * Orchestrates the complete text message sending workflow, including quoted keys, database logs, and UI notifications.
   */
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

    const sentMsg = await sock.sendMessage(targetJid, messageContent)
    if (!sentMsg) throw new Error('Failed to send message')

    const processed = await this.messageProcessingService.processMessage(sentMsg, sock)
    if (!processed || 'type' in processed) {
      throw new Error('Failed to process sent message')
    }
    await this.chatService.updateTimestamp(targetJid, processed.timestamp)

    const nameMap = await this.contactService.batchResolveNames([processed.participant || targetJid, ...(mentions || [])], sock)
    const enriched = await this.messageQueryService.enrichMessage(processed, sock, nameMap)
    this.getBus()?.emit('message:incoming', {
      chatJid: enriched.chatJid,
      senderJid: cleanJid(enriched.participant || enriched.chatJid),
      messageType: enriched.messageType,
      textContent: processed.textContent,
      fromMe: enriched.fromMe,
      timestamp: BigInt(enriched.timestamp),
      processed: processed,
      sock
    }).catch((err) => {
      console.error('[MessageActionService] Failed to emit message:incoming event:', err)
    })
    return enriched
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
        console.error('[MessageActionService] Failed to cache sent media file:', err)
      }
    }
  }

  /**
   * Orchestrates the complete media message sending workflow, including loading files, options extraction, sending, database logs, and UI updates.
   */
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
    const isAlreadyProcessed = isAppUri

    let isTempFile = false
    const isSticker = finalPathToSend.toLowerCase().endsWith('.webp')
    if (isSticker && !isAlreadyProcessed) {
      try {
        finalPathToSend = await stickerMetadataService.processAndAddMetadata(finalPathToSend)
        isTempFile = true
      } catch (err: unknown) {
        console.error('[MessageActionService] Failed to process sticker metadata:', err)
      }
    }

    const buffer = this.fileStorage.readFile(finalPathToSend)
    const sendOptions = getMediaSendOptions(finalPathToSend, buffer, caption)
    if (mentions && mentions.length > 0) sendOptions.mentions = mentions
    if (contextInfo) sendOptions.contextInfo = contextInfo

    const sentMsg = await sock.sendMessage(targetJid, sendOptions as unknown as AnyMessageContent)
    if (!sentMsg) {
      if (isTempFile) this.fileStorage.deleteFile(finalPathToSend)
      throw new Error('Failed to send media message')
    }

    const processed = await this.messageProcessingService.processMessage(sentMsg, sock)
    if (!processed || 'type' in processed) {
      if (isTempFile) this.fileStorage.deleteFile(finalPathToSend)
      throw new Error('Failed to process sent message')
    }

    await this.cacheSentMediaFile(processed, finalPathToSend)

    if (isTempFile) this.fileStorage.deleteFile(finalPathToSend)

    await this.chatService.updateTimestamp(targetJid, processed.timestamp)
    
    const nameMap = await this.contactService.batchResolveNames([processed.participant || targetJid, ...(mentions || [])], sock)
    const enriched = await this.messageQueryService.enrichMessage(processed, sock, nameMap)
    this.getBus()?.emit('message:incoming', {
      chatJid: enriched.chatJid,
      senderJid: cleanJid(enriched.participant || enriched.chatJid),
      messageType: enriched.messageType,
      textContent: processed.textContent,
      fromMe: enriched.fromMe,
      timestamp: BigInt(enriched.timestamp),
      processed: processed,
      sock
    }).catch((err) => {
      console.error('[MessageActionService] Failed to emit message:incoming event:', err)
    })
    return enriched
  }

}
