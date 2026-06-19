import { ContactService } from '../contacts/ContactService'
import { IIdentityRepository } from '../contacts/IIdentityRepository'
import { join } from 'path'
import { MessageService } from './MessageService'
import { IMessageRepository } from './IMessageRepository'
import { IReactionRepository } from './IReactionRepository'
import { IMessageQueryRepository } from './IMessageQueryRepository'
import { ChatService } from '../chats/ChatService'
import { proto, AnyMessageContent } from '@whiskeysockets/baileys'
import { WASocket, MediaMessageWithLocalUri } from '../whatsapp/types'
import { EnrichedMessage } from '../../ipc/types'
import { unwrapMessage, cleanJid } from '../../utils'
import type { IWAEventBus } from '../whatsapp/IWAEventBus'
import { stickerMetadataService } from './StickerMetadataService'
import { getMediaSendOptions } from './MediaHelper'
import { LocalFileStorage } from '../storage/LocalFileStorage'


export class MessageActionService {
  private readonly fileStorage: LocalFileStorage

  constructor(
    private readonly messageRepository: IMessageRepository,
    private readonly reactionRepository: IReactionRepository,
    private readonly messageQueryRepository: IMessageQueryRepository,
    private readonly identityRepository: IIdentityRepository,
    private readonly contactService: ContactService,
    private readonly messageService: MessageService,
    private readonly chatService: ChatService,
    private readonly getBus: () => IWAEventBus | null,
    fileStorage?: LocalFileStorage
  ) {
    // Allow injection for testing; default to concrete adapter for production
    this.fileStorage = fileStorage ?? new LocalFileStorage()
  }

  /**
   * Deletes (revokes) a message.
   */
  async deleteMessage(sock: WASocket, messageId: string, jid?: string): Promise<{ success: boolean; detail: string; messageId: string }> {
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
      participant: dbMsg.chatJid.endsWith('@g.us') ? (dbMsg.participant || undefined) : undefined
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

  /**
   * Edits the text content of a message.
   */
  async editMessage(sock: WASocket, messageId: string, newText: string, jid?: string): Promise<EnrichedMessage> {
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
      participant: dbMsg.chatJid.endsWith('@g.us') ? (dbMsg.participant || undefined) : undefined
    };

    const result = await sock.sendMessage(resolvedJid, {
      text: newText,
      edit: msgKey
    });

    if (!result) throw new Error('Failed to edit message via WhatsApp socket');

    const updatedContent = JSON.parse(dbMsg.content || '{}');
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

    const updated = await this.messageRepository.updateAndFetchMessageWithSender(
      messageId, newText, JSON.stringify(updatedContent)
    )
    if (!updated) throw new Error('Failed to fetch updated message after edit')

    const nameMap = await this.contactService.batchResolveNames([updated.participant || resolvedJid], sock);
    const enriched = await this.messageService.enrichMessage(updated, sock, nameMap);

    this.getBus()?.emit('message:edited', {
      messageId,
      chatJid: enriched.chatJid,
      editedTextContent: newText,
      editedContent: updatedContent as proto.IMessage,
      sock
    }).catch((err) => {
      console.error('[MessageActionService] Failed to emit message:edited event:', err)
    });

    return enriched;
  }

  /**
   * Forwards a message to one or more destination JIDs/LIDs.
   */
  async forwardMessage(sock: WASocket, messageId: string, targetJids: string[], jid?: string): Promise<{ success: boolean; detail: string; results: Array<{ jid: string; messageId: string }> }> {
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
      message: proto.Message.fromObject(rawMessage),
      messageTimestamp: Number(dbMsg.timestamp)
    };

    let destinations: string[] = [];
    if (targetJids && Array.isArray(targetJids) && targetJids.length > 0) {
      destinations = targetJids;
    } else if (jid) {
      destinations = [jid];
    } else {
      throw new Error('Missing destination for forwarding: targetJids or jid must be specified');
    }

    const results: { jid: string; messageId: string }[] = [];
    for (const destJid of destinations) {
      const resolvedDest = await this.contactService.resolveLidFromJid(destJid);

      const sentMsg = await sock.sendMessage(resolvedDest, { forward: waMessage });
      if (!sentMsg) {
        throw new Error(`Failed to forward message ${messageId} to ${resolvedDest}`);
      }

      const processed = await this.messageService.processMessage(sentMsg, sock);
      if (!processed || 'type' in processed) {
        throw new Error('Failed to process forwarded message');
      }
      await this.chatService.updateTimestamp(resolvedDest, processed.timestamp);

      const nameMap = await this.contactService.batchResolveNames(
        [processed.participant || resolvedDest],
        sock
      );
      const enriched = await this.messageService.enrichMessage(processed, sock, nameMap);
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
      });

      results.push({
        jid: resolvedDest,
        messageId: processed.id
      });
    }

    return {
      success: true,
      detail: `Message ${messageId} successfully forwarded to ${destinations.length} destination(s)`,
      results
    };
  }

  /**
   * Reacts to a message with an emoji, or removes the reaction.
   */
  async reactToMessage(sock: WASocket, messageId: string, reaction: string, jid?: string): Promise<{ success: boolean; detail: string; messageId: string; reaction: string }> {
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
      participant: dbMsg.chatJid.endsWith('@g.us') ? (dbMsg.participant || undefined) : undefined
    };

    // Send the reaction message via WhatsApp
    const result = await sock.sendMessage(resolvedJid, {
      react: {
        text: reaction, // Empty string removes/revokes the reaction
        key: msgKey
      }
    });

    if (!result) throw new Error('Failed to send reaction via WhatsApp socket');

    // Update the database Reaction table
    // 1. Resolve our own identity ID
    let reactorId: number | null = null;
    const meIdent = await this.identityRepository.findMeIdentity();
    if (meIdent) {
      reactorId = meIdent.id;
    } else {
      const myRawJid = sock?.user?.id;
      const myJidClean = myRawJid ? myRawJid.split(':')[0] : null;
      if (myJidClean) {
        reactorId = await this.contactService.getIdentityIdByJid(myJidClean);
        if (!reactorId) {
          const myLid = (sock?.user as unknown as { lid?: string })?.lid?.split(':')[0];
          if (myLid) reactorId = await this.contactService.getIdentityIdByJid(myLid);
        }
      }
    }

    if (!reactorId) {
      throw new Error('Failed to resolve logged-in user identity to record the reaction');
    }

    const timestamp = BigInt(Math.floor(Date.now() / 1000));

    if (!reaction) {
      // Remove reaction
      await this.reactionRepository.deleteReactions(messageId, reactorId);
    } else {
      // Upsert reaction
      await this.reactionRepository
        .upsertReaction(messageId, reactorId, reaction, timestamp);
    }

    // Reactions are fully handled by ReceiptSubscriber via the reaction:update bus event.

    return {
      success: true,
      detail: reaction 
        ? `Reacted to message ${messageId} with emoji "${reaction}"`
        : `Removed reaction from message ${messageId}`,
      messageId,
      reaction
    };
  }

  /**
   * Orchestrates the complete text message sending workflow, including quoted keys, database logs, and UI notifications.
   */
  async sendMessageWorkflow(
    sock: WASocket,
    jid: string,
    text: string,
    quotedMsgId?: string,
    mentions?: string[]
  ): Promise<EnrichedMessage> {
    const targetJid = await this.contactService.resolveLidFromJid(jid)

    let contextInfo: proto.IContextInfo | undefined = undefined
    if (quotedMsgId) {
      const qm = await this.messageQueryRepository.findMessageById(quotedMsgId)
      if (qm && qm.content) {
        try { 
          const rawQuoted = JSON.parse(qm.content)
          const msgType = Object.keys(rawQuoted)[0]
          if (msgType && rawQuoted[msgType] && typeof rawQuoted[msgType] === 'object') {
            delete rawQuoted[msgType].contextInfo
          }
          const quotedMessage = proto.Message.fromObject(rawQuoted)

          let participant = qm.participant ? cleanJid(qm.participant) : undefined
          if (qm.fromMe) {
            participant = targetJid.endsWith('@lid') && sock.user?.lid 
              ? cleanJid(sock.user.lid) 
              : (sock.user?.id ? cleanJid(sock.user.id) : undefined)
          } else if (!targetJid.endsWith('@g.us')) {
            participant = targetJid
          }

          if (participant) {
            contextInfo = {
              stanzaId: quotedMsgId,
              participant: cleanJid(participant),
              quotedMessage
            }
          }
        } catch (e) {
          console.error('[sendMessageWorkflow] Failed to construct contextInfo:', e)
        }
      }
    }

    const messageContent: Extract<AnyMessageContent, { text: string }> = { text }
    if (mentions && mentions.length > 0) messageContent.mentions = mentions
    if (contextInfo) messageContent.contextInfo = contextInfo

    const sentMsg = await sock.sendMessage(targetJid, messageContent)
    if (!sentMsg) throw new Error('Failed to send message')

    const processed = await this.messageService.processMessage(sentMsg, sock)
    if (!processed || 'type' in processed) {
      throw new Error('Failed to process sent message')
    }
    await this.chatService.updateTimestamp(targetJid, processed.timestamp)

    const nameMap = await this.contactService.batchResolveNames([processed.participant || targetJid, ...(mentions || [])], sock)
    const enriched = await this.messageService.enrichMessage(processed, sock, nameMap)
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

  /**
   * Orchestrates the complete media message sending workflow, including loading files, options extraction, sending, database logs, and UI updates.
   */
  async sendMediaMessageWorkflow(
    sock: WASocket,
    jid: string,
    filePath: string,
    caption?: string,
    quotedMsgId?: string,
    mentions?: string[]
  ): Promise<EnrichedMessage> {
    const targetJid = await this.contactService.resolveLidFromJid(jid)

    let contextInfo: proto.IContextInfo | undefined = undefined
    if (quotedMsgId) {
        const qm = await this.messageQueryRepository.findMessageById(quotedMsgId)
        if (qm && qm.content) {
          try { 
            const rawQuoted = JSON.parse(qm.content)
            const msgType = Object.keys(rawQuoted)[0]
            if (msgType && rawQuoted[msgType] && typeof rawQuoted[msgType] === 'object') {
              delete rawQuoted[msgType].contextInfo
            }
            const quotedMessage = proto.Message.fromObject(rawQuoted)

            let participant = qm.participant ? cleanJid(qm.participant) : undefined
            if (qm.fromMe) {
              participant = targetJid.endsWith('@lid') && sock.user?.lid 
                ? cleanJid(sock.user.lid) 
                : (sock.user?.id ? cleanJid(sock.user.id) : undefined)
            } else if (!targetJid.endsWith('@g.us')) {
              participant = targetJid
            }

            if (participant) {
              contextInfo = {
                stanzaId: quotedMsgId,
                participant: cleanJid(participant),
                quotedMessage
              }
            }
          } catch (e) {
            console.error('[sendMediaMessageWorkflow] Failed to construct contextInfo:', e)
          }
        }
    }

    const isAppUri = filePath.startsWith('app://favourites/') || filePath.startsWith('app://media/')
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

    const processed = await this.messageService.processMessage(sentMsg, sock)
    if (!processed || 'type' in processed) {
      if (isTempFile) this.fileStorage.deleteFile(finalPathToSend)
      throw new Error('Failed to process sent message')
    }

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

        const fileName = this.messageService.getSafeMediaFileName(processed.id, mediaType, mediaMsg)
        const cachedFilePath = join(mediaDir, fileName)

        this.fileStorage.copyFile(finalPathToSend, cachedFilePath)

        ;(mediaMsg as MediaMessageWithLocalUri).localURI = `app://media/${fileName}`

        const updatedContent = JSON.stringify(parsedContent)
        await this.messageRepository.updateMessageContent(processed.id, updatedContent)

        processed.content = updatedContent
      } catch (err: unknown) {
        console.error('[MessageActionService] Failed to cache sent media file:', err)
      }
    }

    if (isTempFile) this.fileStorage.deleteFile(finalPathToSend)

    await this.chatService.updateTimestamp(targetJid, processed.timestamp)
    
    const nameMap = await this.contactService.batchResolveNames([processed.participant || targetJid, ...(mentions || [])], sock)
    const enriched = await this.messageService.enrichMessage(processed, sock, nameMap)
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
