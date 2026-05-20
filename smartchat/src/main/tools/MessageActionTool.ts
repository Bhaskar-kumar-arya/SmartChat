import { AITool } from '../services/AIToolService';
import { messageService } from '../services/MessageService';
import { chatService } from '../services/ChatService';
import { contactService } from '../services/ContactService';
import { prisma } from '../auth';
import { BrowserWindow } from 'electron';
import { proto } from '@whiskeysockets/baileys';

export class MessageActionTool implements AITool {
  name = 'messageAction';
  description = `Perform an action on a WhatsApp message such as delete, forward, or edit.

CAN BE USED FOR:
- Deleting/revoking a message you sent (action: 'delete')
- Editing the text content of a message you sent (action: 'edit')
- Forwarding a message to one or more chats or people (action: 'forward')

HOW TO USE:
- For 'delete' and 'edit', the message must be one of your sent messages.
- 'messageId' is the unique ID of the message you want to act upon.
- 'jid' represents the chat where the message resides (for 'delete'/'edit') or the single destination chat (for 'forward'). If not specified for 'delete' or 'edit', it will be resolved from the database.
- For 'edit', provide the new text in 'newText'.
- For 'forward', specify 'targetJids' (an array of destination JIDs/LIDs) or 'jid' (as a single destination JID/LID).`;

  requiresPermission = true;

  parametersSchema = {
    type: 'object',
    properties: {
      action: {
        type: 'string',
        enum: ['delete', 'edit', 'forward'],
        description: 'The action to perform: delete, edit, or forward.'
      },
      messageId: {
        type: 'string',
        description: 'The unique message ID to perform the action on.'
      },
      jid: {
        type: 'string',
        description: 'The WhatsApp JID/LID of the chat containing the message (delete/edit) or destination chat JID/LID (forward).'
      },
      newText: {
        type: 'string',
        description: 'Required only for edit. The new text content of the message.'
      },
      targetJids: {
        type: 'array',
        items: { type: 'string' },
        description: 'Required only for forward if jid is not specified. An array of destination JIDs or LIDs to forward the message to.'
      }
    },
    required: ['action', 'messageId']
  };

  private getSock: () => any;

  constructor(getSock: () => any) {
    this.getSock = getSock;
  }

  async execute(args: any) {
    const { action, messageId, jid, newText, targetJids } = args;
    if (!action || !messageId) {
      throw new Error('Missing required arguments: action, messageId');
    }

    const sock = this.getSock();
    if (!sock) throw new Error('WhatsApp socket is not connected');

    if (action === 'delete') {
      let targetJid = jid;
      const dbMsg = await prisma.message.findUnique({ where: { id: messageId } });
      if (!dbMsg) {
        throw new Error(`Message with ID ${messageId} not found in database`);
      }

      if (!targetJid) {
        targetJid = dbMsg.chatJid;
      }
      const resolvedJid = await contactService.resolveLidFromJid(targetJid);

      const msgKey = {
        remoteJid: dbMsg.chatJid,
        fromMe: dbMsg.fromMe,
        id: messageId,
        participant: dbMsg.chatJid.endsWith('@g.us') ? (dbMsg.participant || undefined) : undefined
      };

      await sock.sendMessage(resolvedJid, { delete: msgKey });

      await prisma.message.update({
        where: { id: messageId },
        data: { isDeleted: true }
      });

      const win = BrowserWindow.getAllWindows().find(w => !w.isDestroyed()) ?? null;
      if (win) {
        win.webContents.send('message-deleted', {
          id: messageId,
          remoteJid: dbMsg.chatJid,
          fromMe: dbMsg.fromMe
        });
      }

      return {
        success: true,
        detail: `Message ${messageId} deleted successfully in chat ${resolvedJid}`,
        messageId
      };

    } else if (action === 'edit') {
      if (!newText) {
        throw new Error('Missing required argument: newText is required for editing a message');
      }

      let targetJid = jid;
      const dbMsg = await prisma.message.findUnique({ where: { id: messageId }, include: { sender: true } });
      if (!dbMsg) {
        throw new Error(`Message with ID ${messageId} not found in database`);
      }

      if (!targetJid) {
        targetJid = dbMsg.chatJid;
      }
      const resolvedJid = await contactService.resolveLidFromJid(targetJid);

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

      const updated = await prisma.message.update({
        where: { id: messageId },
        data: { textContent: newText, isEdited: true },
        include: { sender: true }
      });

      const nameMap = await contactService.batchResolveNames([updated.participant || resolvedJid], sock);
      const enriched = await messageService.enrichMessage(updated, sock, nameMap);

      const win = BrowserWindow.getAllWindows().find(w => !w.isDestroyed()) ?? null;
      if (win) {
        win.webContents.send('message-edited', enriched);
      }

      return {
        success: true,
        detail: `Message ${messageId} edited successfully to: "${newText}"`,
        messageId,
        newText
      };

    } else if (action === 'forward') {
      const dbMsg = await prisma.message.findUnique({ where: { id: messageId } });
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
        const resolvedDest = await contactService.resolveLidFromJid(destJid);

        const sentMsg = await sock.sendMessage(resolvedDest, { forward: waMessage });
        if (!sentMsg) {
          throw new Error(`Failed to forward message ${messageId} to ${resolvedDest}`);
        }

        const processed = await messageService.processMessage(sentMsg, sock);
        await chatService.updateTimestamp(resolvedDest, processed.timestamp);

        const win = BrowserWindow.getAllWindows().find(w => !w.isDestroyed()) ?? null;
        if (win) {
          const nameMap = await contactService.batchResolveNames(
            [processed.participant || resolvedDest],
            sock
          );
          const enriched = await messageService.enrichMessage(processed, sock, nameMap);
          win.webContents.send('new-message', enriched);
        }

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

    } else {
      throw new Error(`Unknown action: ${action}`);
    }
  }
}
