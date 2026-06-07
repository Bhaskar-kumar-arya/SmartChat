import { PrismaClient } from '@prisma/client'
import { ContactService } from '../contacts/ContactService'
import fs from 'fs'
import { join } from 'path'
import { MessageService } from './MessageService'
import { ChatService } from '../chats/ChatService'
import { BrowserWindow, app } from 'electron'
import { proto } from '@whiskeysockets/baileys'
import { WASocket, EnrichedMessage } from '../../types'
import { unwrapMessage } from '../../utils'

export class MessageActionService {
  constructor(
    private prisma: PrismaClient,
    private contactService: ContactService,
    private messageService: MessageService,
    private chatService: ChatService
  ) {}

  /**
   * Helper to send notification to all open BrowserWindow instances.
   */
  private notifyWindows(event: string, payload: any) {
    const windows = BrowserWindow.getAllWindows();
    for (const win of windows) {
      if (!win.isDestroyed()) {
        win.webContents.send(event, payload);
      }
    }
  }

  /**
   * Deletes (revokes) a message.
   */
  async deleteMessage(sock: WASocket, messageId: string, jid?: string): Promise<{ success: boolean; detail: string; messageId: string }> {
    let targetJid = jid;
    const dbMsg = await this.prisma.message.findUnique({ where: { id: messageId } });
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

    await this.prisma.message.update({
      where: { id: messageId },
      data: { isDeleted: true }
    });

    this.notifyWindows('message-deleted', {
      id: messageId,
      chatJid: dbMsg.chatJid,
      fromMe: dbMsg.fromMe
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
    const dbMsg = await this.prisma.message.findUnique({ where: { id: messageId }, include: { sender: true } });
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

    const updated = await this.prisma.message.update({
      where: { id: messageId },
      data: { textContent: newText, content: JSON.stringify(updatedContent), isEdited: true },
      include: { sender: true }
    });

    const nameMap = await this.contactService.batchResolveNames([updated.participant || resolvedJid], sock);
    const enriched = await this.messageService.enrichMessage(updated, sock, nameMap);

    this.notifyWindows('message-edited', enriched);

    return enriched;
  }

  /**
   * Forwards a message to one or more destination JIDs/LIDs.
   */
  async forwardMessage(sock: WASocket, messageId: string, targetJids: string[], jid?: string): Promise<{ success: boolean; detail: string; results: Array<{ jid: string; messageId: string }> }> {
    const dbMsg = await this.prisma.message.findUnique({ where: { id: messageId } });
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
      this.notifyWindows('new-message', enriched);

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
    const dbMsg = await this.prisma.message.findUnique({ where: { id: messageId } });
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
    const meIdent = await this.prisma.identity.findFirst({ where: { isMe: true } });
    if (meIdent) {
      reactorId = meIdent.id;
    } else {
      const myRawJid = sock?.user?.id;
      const myJidClean = myRawJid ? myRawJid.split(':')[0] : null;
      if (myJidClean) {
        reactorId = await this.contactService.getIdentityIdByJid(myJidClean);
        if (!reactorId) {
          const myLid = (sock?.user as { lid?: string })?.lid?.split(':')[0];
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
      await this.prisma.reaction.deleteMany({
        where: { messageId, senderId: reactorId }
      }).catch(() => {});
    } else {
      // Upsert reaction
      await this.prisma.reaction.upsert({
        where: { messageId_senderId: { messageId, senderId: reactorId } },
        update: { text: reaction, timestamp },
        create: { messageId, senderId: reactorId, text: reaction, timestamp }
      }).catch(() => {});
    }

    // 2. Notify the frontend to update UI reactively
    const myJid = sock.user?.id || '';
    const myLid = (sock.user as { lid?: string })?.lid || '';
    const reactorJidString = myLid ? myLid.split(':')[0] + '@lid' : (myJid ? myJid.split(':')[0] + '@s.whatsapp.net' : '');

    const nameMap = await this.contactService.batchResolveNames([reactorJidString], sock);
    const reactorName = nameMap.get(reactorJidString) || sock.user?.name || 'Me';

    const mockMsg = {
      id: messageId,
      chatJid: dbMsg.chatJid,
      fromMe: true,
      senderId: reactorId,
      participant: reactorJidString,
      participantName: reactorName,
      timestamp: timestamp.toString(),
      messageType: 'reactionMessage',
      content: JSON.stringify({
        reactionMessage: {
          key: { id: messageId },
          text: reaction || ''
        }
      })
    };

    this.notifyWindows('new-message', mockMsg);

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

    let quoted: any = undefined
    if (quotedMsgId) {
      const qm = await this.prisma.message.findUnique({ where: { id: quotedMsgId } })
      if (qm && qm.content) {
        try { 
          quoted = { key: { id: quotedMsgId, remoteJid: qm.chatJid, fromMe: qm.fromMe }, message: proto.Message.fromObject(JSON.parse(qm.content)) }
        } catch (e) {}
      }
    }

    const messageContent: any = { text }
    if (mentions && mentions.length > 0) messageContent.mentions = mentions

    const sentMsg = await sock.sendMessage(targetJid, messageContent, { quoted } as any)
    if (!sentMsg) throw new Error('Failed to send message')

    const processed = await this.messageService.processMessage(sentMsg, sock)
    if (!processed || 'type' in processed) {
      throw new Error('Failed to process sent message')
    }
    await this.chatService.updateTimestamp(targetJid, processed.timestamp)

    const nameMap = await this.contactService.batchResolveNames([processed.participant || targetJid, ...(mentions || [])], sock)
    return this.messageService.enrichMessage(processed, sock, nameMap)
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

    let quoted: any = undefined
    if (quotedMsgId) {
        const qm = await this.prisma.message.findUnique({ where: { id: quotedMsgId } })
        if (qm && qm.content) {
          try { 
            quoted = { key: { id: quotedMsgId, remoteJid: qm.chatJid, fromMe: qm.fromMe }, message: proto.Message.fromObject(JSON.parse(qm.content)) }
          } catch (e) {}
        }
    }

    const buffer = fs.readFileSync(filePath)
    const sendOptions = this.messageService.getMediaSendOptions(filePath, buffer, caption)
    if (mentions && mentions.length > 0) sendOptions.mentions = mentions

    const sentMsg = await sock.sendMessage(targetJid, sendOptions as any, { quoted } as any)
    if (!sentMsg) throw new Error('Failed to send media message')

    const processed = await this.messageService.processMessage(sentMsg, sock)
    if (!processed || 'type' in processed) {
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
        const mediaDir = join(app.getPath('userData'), 'media')
        if (!fs.existsSync(mediaDir)) fs.mkdirSync(mediaDir, { recursive: true })

        const fileName = this.messageService.getSafeMediaFileName(processed.id, mediaType, mediaMsg)
        const cachedFilePath = join(mediaDir, fileName)

        fs.copyFileSync(filePath, cachedFilePath)

        mediaMsg.localURI = `app://media/${fileName}`

        const updatedContent = JSON.stringify(parsedContent)
        await this.prisma.message.update({
          where: { id: processed.id },
          data: { content: updatedContent }
        })

        processed.content = updatedContent
      } catch (err) {
        console.error('[MessageActionService] Failed to cache sent media file:', err)
      }
    }

    await this.chatService.updateTimestamp(targetJid, processed.timestamp)
    
    const nameMap = await this.contactService.batchResolveNames([processed.participant || targetJid, ...(mentions || [])], sock)
    return this.messageService.enrichMessage(processed, sock, nameMap)
  }
}
