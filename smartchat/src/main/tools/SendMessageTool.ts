import { AITool } from '../services/AIToolService';
import { messageService } from '../services/MessageService';
import { chatService } from '../services/ChatService';

export class SendMessageTool implements AITool {
  name = 'sendMessage';
  description = 'Send a message to a specific WhatsApp user or group by their JID (e.g. 1234567890@s.whatsapp.net). Always requires their JID.';
  requiresPermission = true;
  parametersSchema = {
    type: 'object',
    properties: {
      jid: { type: 'string', description: 'The exact WhatsApp JID to send the message to (e.g. 123@s.whatsapp.net or 123-456@g.us)' },
      text: { type: 'string', description: 'The content of the message to send' }
    },
    required: ['jid', 'text']
  };

  private getSock: () => any;

  constructor(getSock: () => any) {
    this.getSock = getSock;
  }

  async execute(args: any) {
    const { jid, text } = args;
    if (!jid || !text) throw new Error('Missing required arguments: jid, text');

    const sock = this.getSock();
    if (!sock) throw new Error('WhatsApp socket is not connected');

    const messageContent: any = { text };
    const sentMsg = await sock.sendMessage(jid, messageContent);
    if (!sentMsg) throw new Error('Failed to send message');
    
    // Persist via Service
    const processed = await messageService.processMessage(sentMsg, sock);
    await chatService.updateTimestamp(jid, processed.timestamp);

    return { 
      success: true, 
      detail: `Message sent successfully to ${jid}` 
    };
  }
}
