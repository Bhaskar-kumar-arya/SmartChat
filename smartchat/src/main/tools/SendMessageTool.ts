import { AITool } from '../services/AIToolService';
import { messageService } from '../services/MessageService';
import { chatService } from '../services/ChatService';

export class SendMessageTool implements AITool {
  name = 'sendMessage';
  description = 'Send a message. To mention someone in a group, include @ID (the part of the JID before the @) in the text and also add their full JIDs to the mentions array.';
  requiresPermission = true;
  parametersSchema = {
    type: 'object',
    properties: {
      jid: { type: 'string', description: 'The exact WhatsApp JID to send the message to (e.g. 123@s.whatsapp.net or 123-456@g.us)' },
      text: { type: 'string', description: 'The content of the message to send. Use @ID/phone_number to mention someone.' },
      mentions: { 
        type: 'array', 
        items: { type: 'string' }, 
        description: 'Optional array of full WhatsApp JIDs (e.g. 1234567890@s.whatsapp.net or 1234567890@lid) to mention in the message. These should correspond to @ID mentions in the text.' 
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
