import { AITool } from '../services/AIToolService';
import { prisma } from '../auth';
import { contactService } from '../services/ContactService';

export class MessageActionTool implements AITool {
  name = 'messageAction';
  description = `Perform an action (react, delete, forward, edit) on an existing WhatsApp message.

CAN BE USED FOR:
- Deleting a message sent by the user ('delete')
- Reacting to a message with an emoji ('react')
- Forwarding a message to another chat ('forward')
- Editing a message sent by the user ('edit')

HOW TO USE:
- 'action' must be one of: "react", "delete", "forward", "edit".
- 'messageId' is the exact database ID of the message to act upon. You may need to use queryDatabase to find this ID.
- 'jid' is the WhatsApp JID of the chat where the original message resides.
- If action is "react", you MUST provide 'reactEmoji'.
- If action is "forward", you MUST provide 'forwardJid'.
- If action is "edit", you MUST provide 'editText'.

WHAT YOU RECEIVE BACK:
{ "success": true, "detail": "Successfully performed <action> on message <id>" }
If the action fails, the tool throws — check the [SYSTEM] result for the reason.

CONSTRAINTS:
- Use carefully as deletes are permanent.`;
  
  requiresPermission = true;
  parametersSchema = {
    type: 'object',
    properties: {
      action: { type: 'string', enum: ['react', 'delete', 'forward', 'edit'], description: 'The action to perform.' },
      jid: { type: 'string', description: 'The JID of the chat where the message belongs.' },
      messageId: { type: 'string', description: 'The exact ID of the message to act on.' },
      reactEmoji: { type: 'string', description: 'The emoji to react with (REQUIRED if action is react).' },
      forwardJid: { type: 'string', description: 'The JID to forward the message to (REQUIRED if action is forward).' },
      editText: { type: 'string', description: 'The new text content for the message (REQUIRED if action is edit).' }
    },
    required: ['action', 'jid', 'messageId']
  };

  private getSock: () => any;

  constructor(getSock: () => any) {
    this.getSock = getSock;
  }

  async execute(args: any) {
    const { action, jid, messageId, reactEmoji, forwardJid, editText } = args;

    if (!['react', 'delete', 'forward', 'edit'].includes(action)) {
      throw new Error(`Invalid action: ${action}. Must be one of 'react', 'delete', 'forward', 'edit'.`);
    }
    if (!jid || !messageId) {
      throw new Error('Missing required arguments: jid, messageId');
    }

    const sock = this.getSock();
    if (!sock) throw new Error('WhatsApp socket is not connected');

    const targetJid = await contactService.resolveLidFromJid(jid);
    const targetForwardJid = forwardJid ? await contactService.resolveLidFromJid(forwardJid) : undefined;

    // Fetch message from DB
    const msg = await prisma.message.findUnique({ where: { id: messageId } });
    if (!msg) throw new Error(`Message with ID ${messageId} not found in database.`);

    // Build the key
    const msgKey: any = {
      remoteJid: msg.chatJid,
      fromMe: msg.fromMe,
      id: msg.id
    };
    if (msg.chatJid.endsWith('@g.us') && msg.participant) {
      msgKey.participant = msg.participant;
    }

    switch (action) {
      case 'react':
        if (!reactEmoji) throw new Error("Missing required argument 'reactEmoji' for action 'react'");
        await sock.sendMessage(targetJid, { react: { text: reactEmoji, key: msgKey } });
        return { success: true, detail: `Successfully reacted to message ${messageId} with ${reactEmoji}` };

      case 'delete':
        await sock.sendMessage(targetJid, { delete: msgKey });
        return { success: true, detail: `Successfully deleted message ${messageId}` };

      case 'forward':
        if (!targetForwardJid) throw new Error("Missing required argument 'forwardJid' for action 'forward'");
        
        let msgContent: any;
        try {
          msgContent = JSON.parse(msg.content);
        } catch (e) {
          throw new Error(`Failed to parse message content for ${messageId}`);
        }
        
        // Baileys forward syntax
        await sock.sendMessage(targetForwardJid, { forward: { key: msgKey, message: msgContent } });
        return { success: true, detail: `Successfully forwarded message ${messageId} to ${targetForwardJid}` };

      case 'edit':
        if (!editText) throw new Error("Missing required argument 'editText' for action 'edit'");
        if (!msg.fromMe) throw new Error("Cannot edit a message that was not sent by the user.");
        await sock.sendMessage(targetJid, { text: editText, edit: msgKey });
        await prisma.message.update({
          where: { id: messageId },
          data: { textContent: editText, isEdited: true }
        });
        return { success: true, detail: `Successfully edited message ${messageId} to "${editText}"` };

      default:
        throw new Error(`Unsupported action ${action}`);
    }
  }
}
