import { AITool } from '../services/ai/AIToolService';
import { messageActionService } from '../services/messages/MessageActionService';
import { WASocket } from '../types';

export class MessageActionTool implements AITool {
  name = 'messageAction';
  description = `Perform an action on a WhatsApp message such as delete, forward, edit, or react.

CAN BE USED FOR:
- Deleting/revoking a message you sent (action: 'delete')
- Editing the text content of a message you sent (action: 'edit')
- Forwarding a message to one or more chats or people (action: 'forward')
- Reacting to any message with an emoji (action: 'react')

HOW TO USE:
- For 'delete' and 'edit', the message must be one of your sent messages.
- 'messageId' is the unique ID of the message you want to act upon.
- 'jid' represents the chat where the message resides (for 'delete'/'edit'/'react') or the single destination chat (for 'forward'). If not specified for 'delete', 'edit', or 'react', it will be resolved from the database.
- For 'edit', provide the new text in 'newText'.
- For 'forward', specify 'targetJids' (an array of destination JIDs/LIDs) or 'jid' (as a single destination JID/LID).
- For 'react', specify the emoji to react with in 'reaction' (e.g. "👍", "❤️", "😂"), or an empty string "" to remove the reaction.`;

  requiresPermission = true;

  parametersSchema = {
    type: 'object',
    properties: {
      action: {
        type: 'string',
        enum: ['delete', 'edit', 'forward', 'react'],
        description: 'The action to perform: delete, edit, forward, or react.'
      },
      messageId: {
        type: 'string',
        description: 'The unique message ID to perform the action on.'
      },
      jid: {
        type: 'string',
        description: 'The WhatsApp JID/LID of the chat containing the message (delete/edit/react) or destination chat JID/LID (forward).'
      },
      newText: {
        type: 'string',
        description: 'Required only for edit. The new text content of the message.'
      },
      targetJids: {
        type: 'array',
        items: { type: 'string' },
        description: 'Required only for forward if jid is not specified. An array of destination JIDs or LIDs to forward the message to.'
      },
      reaction: {
        type: 'string',
        description: 'Required only for react. The emoji/text to react with (e.g. 👍, ❤️, or an empty string "" to remove/revoke a reaction).'
      }
    },
    required: ['action', 'messageId']
  };

  private getSock: () => WASocket | null;

  constructor(getSock: () => WASocket | null) {
    this.getSock = getSock;
  }

  async execute(args: any) {
    const { action, messageId, jid, newText, targetJids, reaction } = args;
    if (!action || !messageId) {
      throw new Error('Missing required arguments: action, messageId');
    }

    const sock = this.getSock();
    if (!sock) throw new Error('WhatsApp socket is not connected');

    if (action === 'delete') {
      return await messageActionService.deleteMessage(sock, messageId, jid);
    } else if (action === 'edit') {
      if (!newText) {
        throw new Error('Missing required argument: newText is required for editing a message');
      }
      return await messageActionService.editMessage(sock, messageId, newText, jid);
    } else if (action === 'forward') {
      return await messageActionService.forwardMessage(sock, messageId, targetJids || [], jid);
    } else if (action === 'react') {
      if (reaction === undefined) {
        throw new Error('Missing required argument: reaction is required for reacting to a message');
      }
      return await messageActionService.reactToMessage(sock, messageId, reaction, jid);
    } else {
      throw new Error(`Unknown action: ${action}`);
    }
  }
}
