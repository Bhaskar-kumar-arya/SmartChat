import { AITool } from '../services/ai/IToolRegistry';
import { IMessageActionService } from '../services/messages/IMessageActionService';
import { WASocket } from '../services/whatsapp/types';

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
- For 'edit', provide the new text in 'newText'.
- For 'forward', specify 'targetJids' (an array of destination JIDs/LIDs).
- For 'react', specify the emoji to react with in 'reaction' (e.g. "👍", "❤️", "😂"), or an empty string "" to remove the reaction.

WHAT YOU RECEIVE BACK:
- For 'delete', 'edit', 'react': { "messageId": "<messageId>" }
- For 'forward': { "results": [{ "jid": "<jid>", "messageId": "<newForwardedMessageId>" }] }`;

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
      newText: {
        type: 'string',
        description: 'Required only for edit. The new text content of the message.'
      },
      targetJids: {
        type: 'array',
        items: { type: 'string' },
        description: 'Required only for forward. An array of destination JIDs or LIDs to forward the message to.'
      },
      reaction: {
        type: 'string',
        description: 'Required only for react. The emoji/text to react with (e.g. 👍, ❤️, or an empty string "" to remove/revoke a reaction).'
      }
    },
    required: ['action', 'messageId']
  };

  constructor(
    private getSock: () => WASocket | null,
    private messageActionService: IMessageActionService
  ) { }

  async execute(args: Record<string, unknown>): Promise<unknown> {
    const action = args.action as string | undefined;
    const messageId = args.messageId as string | undefined;
    const newText = args.newText as string | undefined;
    const targetJids = args.targetJids as string[] | undefined;
    const reaction = args.reaction as string | undefined;
    if (!action || !messageId) {
      throw new Error('Missing required arguments: action, messageId');
    }

    const sock = this.getSock();
    if (!sock) throw new Error('WhatsApp socket is not connected');

    if (action === 'delete') {
      await this.messageActionService.deleteMessage(sock, messageId);
      return { messageId };
    } else if (action === 'edit') {
      if (!newText) {
        throw new Error('Missing required argument: newText is required for editing a message');
      }
      await this.messageActionService.editMessage(sock, messageId, newText);
      return { messageId };
    } else if (action === 'forward') {
      if (!targetJids || targetJids.length === 0) {
        throw new Error('Missing required argument: targetJids is required for forwarding a message');
      }
      const res = await this.messageActionService.forwardMessage(sock, messageId, targetJids);
      return { results: res.results };
    } else if (action === 'react') {
      if (reaction === undefined) {
        throw new Error('Missing required argument: reaction is required for reacting to a message');
      }
      await this.messageActionService.reactToMessage(sock, messageId, reaction);
      return { messageId };
    } else {
      throw new Error(`Unknown action: ${action}`);
    }
  }
}
