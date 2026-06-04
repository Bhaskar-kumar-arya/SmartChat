import { AITool } from '../services/ai/AIToolService';
import { messageService } from '../services/messages/MessageService';
import { chatService } from '../services/chats/ChatService';

export class SendMessageTool implements AITool {
  name = 'sendMessage';
  description = `Send a WhatsApp message to a chat or person on the user's behalf.

CAN BE USED FOR:
- ONLY when the user explicitly asks to send a message to a person or group
- Do NOT use this to reply to the user in the chatbar — respond conversationally for that

HOW TO USE:
- 'jid' must be the exact WhatsApp JID or LID (e.g. 919876543210@s.whatsapp.net, 123-456@g.us, or 123456@lid). If unsure, query the database first — never guess.
- To mention someone in a group message: put @phoneNumber in 'text' AND include their full JID in the 'mentions' array
- WhatsApp markdown: *bold*, _italic_, ~strikethrough~, \`\`\`monospace\`\`\`

WHAT YOU RECEIVE BACK:
{ "success": true, "detail": "Message sent successfully to <jid>" }
If the send fails, the tool throws — check the [SYSTEM] result for the reason.

CONSTRAINTS:
- Always verify the JID before calling — wrong JIDs send to the wrong person`;
  requiresPermission = true;
  parametersSchema = {
    type: 'object',
    properties: {
      jid: { type: 'string', description: 'The exact WhatsApp JID or LID to send the message to (e.g. 123@s.whatsapp.net, 123-456@g.us, or 123@lid)' },
      text: { type: 'string', description: 'The content of the message to send. Use @phoneNumber to mention someone in a group.' },
      mentions: { 
        type: 'array', 
        items: { type: 'string' }, 
        description: 'Optional array of full WhatsApp JIDs or LIDs to mention in a group message. Must correspond to @phoneNumber references in the text.' 
      }
    },
    required: ['jid', 'text']
  };

  private getSock: () => any;

  constructor(getSock: () => any) {
    this.getSock = getSock;
  }

  async execute(args: any) {
    const { jid, text, mentions } = args;
    if (!jid || !text) throw new Error('Missing required arguments: jid, text');

    const sock = this.getSock();
    if (!sock) throw new Error('WhatsApp socket is not connected');

    const messageContent: any = { text };
    if (mentions && Array.isArray(mentions) && mentions.length > 0) {
      messageContent.mentions = mentions;
    }

    const sentMsg = await sock.sendMessage(jid, messageContent);
    if (!sentMsg) throw new Error('Failed to send message');
    
    // Persist via Service
    const processed = await messageService.processMessage(sentMsg, sock);
    await chatService.updateTimestamp(jid, processed.timestamp);

    return { 
      success: true, 
      detail: `Message sent successfully to ${jid}${mentions ? ` with ${mentions.length} mentions` : ''}` 
    };
  }
}
