import { AITool } from '../services/AIToolService';
import { prisma } from '../auth';

export class ReadChatTool implements AITool {
  name = 'readChat';
  description = 'Read messages from a specific WhatsApp chat with filtering options like date range, message limit, or relative to a message ID.';
  requiresPermission = true;
  parametersSchema = {
    type: 'object',
    properties: {
      jid: { type: 'string', description: 'The exact WhatsApp JID to read messages from (e.g. 123@s.whatsapp.net or 123-456@g.us)' },
      limit: { type: 'number', description: 'Maximum number of messages to return. If not specified, defaults to 20,000.Specify if required value is drastically less than this' },
      afterDate: { type: 'string', description: 'ISO date string or timestamp to fetch messages after' },
      beforeDate: { type: 'string', description: 'ISO date string or timestamp to fetch messages before' },
      afterMessageId: { type: 'string', description: 'Fetch messages sent after this specific message ID' },
      beforeMessageId: { type: 'string', description: 'Fetch messages sent before this specific message ID' },
      inclusive: { type: 'boolean', description: 'Whether to include the boundary message or date in the results', default: false }
    },
    required: ['jid']
  };

  private getSock: () => any;

  constructor(getSock: () => any) {
    this.getSock = getSock;
  }

  async execute(args: any) {
    const { jid, limit, afterDate, beforeDate, afterMessageId, beforeMessageId, inclusive = false } = args;
    
    if (!jid) throw new Error('Missing required argument: jid');

    const finalLimit = limit !== undefined ? Math.min(Math.max(1, limit), 20000) : 20000;
    const where: any = { chatJid: jid }; // updated from remoteJid
    
    let afterTs: bigint | undefined;
    let beforeTs: bigint | undefined;

    if (afterMessageId) {
      const msg = await prisma.message.findUnique({ where: { id: afterMessageId } });
      if (msg) afterTs = msg.timestamp;
    }

    if (beforeMessageId) {
      const msg = await prisma.message.findUnique({ where: { id: beforeMessageId } });
      if (msg) beforeTs = msg.timestamp;
    }

    if (afterDate) {
      const d = new Date(afterDate);
      const ts = BigInt(Math.floor(d.getTime() / 1000));
      if (!afterTs || ts > afterTs) afterTs = ts;
    }

    if (beforeDate) {
      const d = new Date(beforeDate);
      const ts = BigInt(Math.floor(d.getTime() / 1000));
      if (!beforeTs || ts < beforeTs) beforeTs = ts;
    }

    if (afterTs !== undefined || beforeTs !== undefined) {
      where.timestamp = {};
      if (afterTs !== undefined) {
        where.timestamp[inclusive ? 'gte' : 'gt'] = afterTs;
      }
      if (beforeTs !== undefined) {
        where.timestamp[inclusive ? 'lte' : 'lt'] = beforeTs;
      }
    }

    const messages = await prisma.message.findMany({
      where,
      orderBy: { timestamp: 'desc' },
      take: finalLimit + 1,
      include: { sender: true, chat: true } // includes relational data
    });

    const hasMore = messages.length > finalLimit;
    const resultMessages = hasMore ? messages.slice(0, finalLimit) : messages;

    let formattedResponse = `Results for chat ${jid}:\n`;
    formattedResponse += `Range: ${resultMessages.length} messages found.\n`;
    
    if (resultMessages.length > 0) {
      const newest = resultMessages[0];
      const oldest = resultMessages[resultMessages.length - 1];
      formattedResponse += `Newest Message ID: ${newest.id} (${new Date(Number(newest.timestamp) * 1000).toLocaleString()})\n`;
      formattedResponse += `Oldest Message ID: ${oldest.id} (${new Date(Number(oldest.timestamp) * 1000).toLocaleString()})\n`;
    }
    formattedResponse += `\n`;

    if (hasMore) {
      const oldest = resultMessages[resultMessages.length - 1];
      formattedResponse += `> [!IMPORTANT]\n> Message limit (${finalLimit}) reached. Internal history continues beyond this point.\n> To fetch older messages, use 'beforeMessageId' with "${oldest.id}".\n\n`;
    }

    const sorted = [...resultMessages].reverse();
    const participantMap: Record<string, string> = {};
    
    sorted.forEach((m) => {
      let senderName = 'Unknown';
      if (m.fromMe) senderName = 'Me';
      else if (m.sender) senderName = m.sender.displayName || m.sender.pushName || m.sender.verifiedName || m.sender.phoneNumber?.split('@')[0] || 'Unknown';
      else if (m.participant) senderName = m.participant.split('@')[0];
      else senderName = m.chatJid.split('@')[0];

      if (!m.fromMe && m.participant) {
        participantMap[m.participant] = senderName;
      }
    });

    if (Object.keys(participantMap).length > 0) {
      formattedResponse += `\nParticipant Identities (ID -> Name):\n${JSON.stringify(participantMap, null, 2)}\n\n`;
    }

    sorted.forEach((m) => {
      let senderName = 'Unknown';
      if (m.fromMe) senderName = 'Me';
      else if (m.sender) senderName = m.sender.displayName || m.sender.pushName || m.sender.verifiedName || m.sender.phoneNumber?.split('@')[0] || 'Unknown';
      else if (m.participant) senderName = m.participant.split('@')[0];
      else senderName = m.chatJid.split('@')[0];

      const content = m.textContent || `[${m.messageType}]`;
      const dateStr = new Date(Number(m.timestamp) * 1000).toLocaleString();

      formattedResponse += `[${dateStr}] ${senderName}: ${content}\n`;
    });

    return formattedResponse;
  }
}
