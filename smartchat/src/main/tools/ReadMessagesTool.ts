import { AITool } from '../services/ai/AIToolService';
import { MessageRepository } from '../services/messages/MessageRepository';
import { ContactRepository } from '../services/contacts/ContactRepository';
import { ChatRepository } from '../services/chats/ChatRepository';
import { WASocket } from '../types';
import { unwrapMessage, getMessageType } from '../utils';
import { MessageFormatterRegistry } from '../services/messages/formatters/MessageFormatterRegistry';
import { Message } from '@prisma/client';
import { proto } from '@whiskeysockets/baileys';

// Keywords that are never allowed anywhere in the query
const FORBIDDEN_KEYWORDS = [
  'INSERT', 'UPDATE', 'DELETE', 'DROP', 'ALTER',
  'CREATE', 'ATTACH', 'DETACH', 'PRAGMA', 'VACUUM',
  'REPLACE', 'TRUNCATE', 'GRANT', 'REVOKE'
];

export class ReadMessagesTool implements AITool {
  name = 'readMessages';
  description = `Read formatted WhatsApp messages history.

CAN BE USED FOR:
- Reading chat logs or messages when you need a clean, human-readable transcript.
- Automatically decoding and parsing complex WhatsApp message details (e.g., text, link previews, replies, media captions, stickers, voice note durations, locations, polls, and reactions) into a natural, formatted representation.
- Resolving sender and participant database JIDs to friendly display names (e.g., "Me", "Them", or contact names like "John Doe").
- Organizing, dating, and grouping consecutive messages chronologically with clear visual headers.
- Searching or filtering messages via custom SQLite queries (e.g., searching by keyword, finding unread messages, or filtering by date range) when the final goal is to read the message content. The SQL query must select the Message 'id' column.

Note: Compared to 'queryDatabase', this tool is designed for viewing, searching, and reading message threads. Use 'queryDatabase' when you need raw data counts, aggregations, database table introspection, or queries on metadata tables that do not require displaying parsed message logs.
 
HOW TO USE (Select ONE set of arguments):
1. Chat History Mode:
   - 'jid' (required): The exact JID of the WhatsApp chat to read.
   - 'limit' (optional): Maximum number of messages to return. Fetches the most recent messages (descending order by timestamp). Defaults to 100.
2. Custom SQL Query Mode:
   - 'sql' (required): A valid SQLite SELECT/WITH SELECT statement. MUST return message IDs in the 'id' column (e.g. SELECT id FROM Message WHERE ...).
   - 'params' (optional): Placeholder parameters array.
3. Direct Message Mode:
   - 'messages' (required): Direct array of Message objects to format.

CONSTRAINTS:
- 'sql' mode is read-only. Modifications are rejected.

FORMATTING BEHAVIOR:
- The tool groups consecutive messages belonging to the same chat under a single header.
- To avoid highly fragmented output when retrieving messages across multiple chats (e.g., when querying by keywords or time range), it is recommended to sort by chat first, then chronologically (e.g., ORDER BY chatJid ASC, timestamp ASC), provided that order is acceptable for the task.
- Use 'groupByChat: true' to automatically pre-group and sort all messages by chat before formatting, regardless of the original query order. This is ideal when the query mixes messages from multiple chats and you want a clean per-chat breakdown without having to sort in SQL.`;

  requiresPermission = true;
  parametersSchema = {
    type: 'object',
    properties: {
      jid: { type: 'string', description: 'The exact WhatsApp JID to read messages from.' },
      limit: { type: 'number', description: 'Maximum number of messages to return (defaults to 100).' },

      messages: {
        type: 'array',
        items: { type: 'object' },
        description: 'Direct array of Message objects to format.'
      },

      sql: {
        type: 'string',
        description: 'A valid SQLite SELECT (or WITH...SELECT) statement. MUST select the "id" column of the Message table. When querying messages across multiple chats, consider sorting by "chatJid ASC, timestamp ASC" to group the output cleanly by chat (if that order is acceptable).'
      },
      params: {
        type: 'array',
        items: {},
        description: 'Optional array of parameters for the SQL query.'
      },

      groupByChat: {
        type: 'boolean',
        description: 'When true, all messages are pre-grouped by chat (sorted by chatJid, then chronologically within each chat) before formatting. Useful when fetching messages across multiple chats where SQL ordering is not guaranteed or when you want a clean per-chat breakdown. Defaults to false (preserves original message order).'
      }
    }
  };

  constructor(
    _getSock: () => WASocket | null,
    private readonly formatterRegistry: MessageFormatterRegistry,
    private readonly messageRepository: MessageRepository,
    private readonly contactRepository: ContactRepository,
    private readonly chatRepository: ChatRepository
  ) {}

  async execute(args: Record<string, unknown>): Promise<string> {
    const jid = args.jid as string | undefined;
    const limit = args.limit as number | undefined;
    const messages = args.messages as Message[] | undefined;
    const sql = args.sql as string | undefined;
    const params = args.params as unknown[] | undefined;
    const groupByChat = args.groupByChat as boolean | undefined;

    let messagesToFormat: Message[] = [];
    let isJidMode = false;
    let hasMore = false;
    let finalLimit = 100;

    // ── Mode Determination & Data Fetching ───────────────────────────────────────
    if (jid) {
      isJidMode = true;
      finalLimit = limit !== undefined ? Math.min(Math.max(1, limit), 20000) : 100;

      const fetched = await this.messageRepository.findMessagesByChat(jid, finalLimit + 1);

      hasMore = fetched.length > finalLimit;
      const resultMessages = hasMore ? fetched.slice(0, finalLimit) : fetched;
      
      // JID mode returns messages in descending order (newest first).
      // We reverse them to present chronologically.
      messagesToFormat = [...resultMessages].reverse();

    } else if (sql) {
      const trimmed = sql.trim();
      const normalized = trimmed.toUpperCase().replace(/\s+/g, ' ');

      if (!normalized.startsWith('SELECT') && !normalized.startsWith('WITH')) {
        throw new Error(
          `Query rejected: Only SELECT or WITH...SELECT statements are allowed. Got: "${trimmed.slice(0, 40)}..."`
        );
      }

      for (const kw of FORBIDDEN_KEYWORDS) {
        const wordBoundaryRegex = new RegExp(`\\b${kw}\\b`);
        if (wordBoundaryRegex.test(normalized)) {
          throw new Error(
            `Query rejected: Forbidden keyword detected — "${kw}". Only read operations are permitted.`
          );
        }
      }

      // Execute SQL. The query must return rows with an "id" field.
      const rows = await this.messageRepository.queryMessageIdsBySql(trimmed, Array.isArray(params) ? params : []);
      
      if (rows.length > 0 && !rows.some((r) => r.id !== undefined && r.id !== null)) {
        throw new Error('Query rejected: The SQL query must return a column named "id" containing the message IDs.');
      }

      const msgIds = rows.map((r) => r.id as string).filter(Boolean);

      if (msgIds.length > 0) {
        const fetched = await this.messageRepository.findMessagesByIds(msgIds);

        // Re-order fetched messages to preserve original query sorting order
        const idToMsg = new Map(fetched.map(m => [m.id, m]));
        messagesToFormat = msgIds.map(id => idToMsg.get(id)).filter((m): m is Message => m !== undefined);
      } else {
        messagesToFormat = [];
      }

    } else if (Array.isArray(messages)) {
      messagesToFormat = messages;
    } else {
      throw new Error('Missing required arguments: Provide jid, sql, or messages.');
    }

    if (messagesToFormat.length === 0) {
      return isJidMode ? `No messages found in chat ${jid}.` : 'No messages found.';
    }

    // ── Group By Chat (pre-sort) ───────────────────────────────────────────────
    if (groupByChat && !isJidMode) {
      // Bucket messages by chatJid, preserving chronological order within each chat
      const buckets = new Map<string, Message[]>();
      for (const m of messagesToFormat) {
        const key = m.chatJid || 'unknown_chat';
        let bucket = buckets.get(key);
        if (!bucket) {
          bucket = [];
          buckets.set(key, bucket);
        }
        bucket.push(m);
      }

      // Sort buckets by chatJid alphabetically, then sort messages within each bucket by timestamp
      const sortedKeys = Array.from(buckets.keys()).sort();
      messagesToFormat = sortedKeys.flatMap(key => {
        const bucket = buckets.get(key);
        if (bucket) {
          bucket.sort((a, b) => Number(a.timestamp) - Number(b.timestamp));
          return bucket;
        }
        return [];
      });
    }

    // ── Resolve Display Names & Chats ──────────────────────────────────────────
    const { nameMap, chatInfoMap } = await this.resolveNamesAndChats(messagesToFormat);

    // ── Formatting Output ──────────────────────────────────────────────────────
    const formatDateTime = (ts: string | number) => {
      const date = new Date(Number(ts) * 1000);
      const dateStr = date.toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
      const timeStr = date.toLocaleTimeString();
      return `${dateStr} ${timeStr}`;
    };

    const formatDateOnly = (ts: string | number) => {
      const date = new Date(Number(ts) * 1000);
      return date.toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
    };

    let formattedResponse = '';
    if (isJidMode) {
      formattedResponse += `Results for chat ${jid}:\n`;
      formattedResponse += `Range: ${messagesToFormat.length} messages found.\n`;
      if (messagesToFormat.length > 0) {
        const oldest = messagesToFormat[0];
        const newest = messagesToFormat[messagesToFormat.length - 1];
        formattedResponse += `Newest Message ID: ${newest.id} (${formatDateTime(Number(newest.timestamp))})\n`;
        formattedResponse += `Oldest Message ID: ${oldest.id} (${formatDateTime(Number(oldest.timestamp))})\n`;
      }
      formattedResponse += `\n`;
      if (hasMore) {
        const oldest = messagesToFormat[0];
        formattedResponse += `> [... history continues before message ${oldest.id} ...]\n\n`;
      }
    } else {
      formattedResponse += `Results: ${messagesToFormat.length} messages.\n\n`;
    }

    // Identify runs of continuous messages belonging to the same chat
    interface ChatRun {
      chatJid: string;
      chatName: string;
      chatType: string;
      isDM: boolean;
      messages: Message[];
    }

    const chatRuns: ChatRun[] = [];
    let currentChatRun: ChatRun | null = null;

    for (const m of messagesToFormat) {
      const chatJid = m.chatJid || 'unknown_chat';
      const chatInfo = chatInfoMap.get(chatJid);
      const isDM = chatInfo ? chatInfo.type === 'DM' : !chatJid.endsWith('@g.us');
      const chatName = chatInfo ? chatInfo.name : (nameMap.get(chatJid) || chatJid.split('@')[0]);
      const chatType = chatInfo ? chatInfo.type : (chatJid.endsWith('@g.us') ? 'GROUP' : 'DM');

      if (!currentChatRun || currentChatRun.chatJid !== chatJid) {
        currentChatRun = {
          chatJid,
          chatName,
          chatType,
          isDM,
          messages: []
        };
        chatRuns.push(currentChatRun);
      }
      currentChatRun.messages.push(m);
    }

    // Process each chat run
    for (const run of chatRuns) {
      if (run.messages.length <= 1) {
        // Run of exactly 1 message: print on a single line
        for (const m of run.messages) {
          const senderLabel = this.getSenderLabel(m, run.isDM, nameMap);
          const dateTimeStr = formatDateTime(Number(m.timestamp));
          
          let contentObj: Record<string, unknown> | null = null;
          try {
            contentObj = typeof m.content === 'string' ? JSON.parse(m.content) as Record<string, unknown> : m.content as Record<string, unknown>;
          } catch (e: unknown) {
            console.warn('[ReadMessagesTool] Failed to parse message content:', e);
          }
          const unwrapped = unwrapMessage(contentObj);
          
          const formattedContent = this.formatMessageContent(m, unwrapped);
          const replyContext = this.getReplyContextString(unwrapped, nameMap, run.isDM);
          
          formattedResponse += `[Chat: ${run.chatName} (${run.chatType})] [${dateTimeStr}] ${senderLabel}: ${replyContext}${formattedContent}\n`;
        }
      } else {
        // Run of > 1 messages: print header
        formattedResponse += `=== Chat: ${run.chatName} (${run.chatType}) (${run.chatJid}) ===\n`;

        // Group messages within this run by date first
        interface DateGroup {
          dateStr: string;
          messages: Message[];
        }

        const dateGroups: DateGroup[] = [];
        let currentDateGroup: DateGroup | null = null;

        for (const m of run.messages) {
          const dateStr = formatDateOnly(Number(m.timestamp));
          if (!currentDateGroup || currentDateGroup.dateStr !== dateStr) {
            currentDateGroup = {
              dateStr,
              messages: []
            };
            dateGroups.push(currentDateGroup);
          }
          currentDateGroup.messages.push(m);
        }

        for (const dGroup of dateGroups) {
          // Print date header/separator
          formattedResponse += `--- ${dGroup.dateStr} ---\n`;

          // Group consecutive messages within this date group by sender
          interface SenderRun {
            senderLabel: string;
            messages: Message[];
          }

          const senderRuns: SenderRun[] = [];
          let currentSenderRun: SenderRun | null = null;

          for (const m of dGroup.messages) {
            const senderLabel = this.getSenderLabel(m, run.isDM, nameMap);
            if (!currentSenderRun || currentSenderRun.senderLabel !== senderLabel) {
              currentSenderRun = {
                senderLabel,
                messages: []
              };
              senderRuns.push(currentSenderRun);
            }
            currentSenderRun.messages.push(m);
          }

          for (const sRun of senderRuns) {
            const firstMsg = sRun.messages[0];
            const firstTime = new Date(Number(firstMsg.timestamp) * 1000).toLocaleTimeString();
            
            formattedResponse += `[${firstTime}] ${sRun.senderLabel}:\n`;
            
            for (const m of sRun.messages) {
              const timeStr = new Date(Number(m.timestamp) * 1000).toLocaleTimeString();
              
              let contentObj: Record<string, unknown> | null = null;
              try {
                contentObj = typeof m.content === 'string' ? JSON.parse(m.content) as Record<string, unknown> : m.content as Record<string, unknown>;
              } catch (e: unknown) {
                console.warn('[ReadMessagesTool] Failed to parse message content:', e);
              }
              const unwrapped = unwrapMessage(contentObj);
              
              const formattedContent = this.formatMessageContent(m, unwrapped);
              const replyContext = this.getReplyContextString(unwrapped, nameMap, run.isDM);
              
              formattedResponse += `  - [${timeStr}] ${replyContext}${formattedContent}\n`;
            }
          }
        }
        formattedResponse += `\n`;
      }
    }

    return formattedResponse;
  }

  // ── Helper Resolvers ────────────────────────────────────────────────────────
  private async resolveNamesAndChats(messages: Message[]) {
    const uniqueJids = new Set<string>();
    for (const m of messages) {
      if (m.chatJid) uniqueJids.add(m.chatJid);
      if (m.participant) uniqueJids.add(m.participant);
      
      if (m.content) {
        try {
          const contentObj = typeof m.content === 'string' ? JSON.parse(m.content) as Record<string, unknown> : m.content as Record<string, unknown>;
          const unwrapped = unwrapMessage(contentObj);
          const quoted = this.getQuotedMessageContext(unwrapped);
          if (quoted && quoted.participant) {
            uniqueJids.add(quoted.participant);
          }
        } catch (e: unknown) {
          console.warn('[ReadMessagesTool] Failed to resolve name context:', e);
        }
      }
    }

    const nameMap = new Map<string, string>();

    // Pre-populate Me aliases
    const meIdent = await this.contactRepository.findMeIdentity();
    if (meIdent) {
      for (const alias of meIdent.aliases) {
        nameMap.set(alias.jid, 'Me');
      }
    }

    const aliases = await this.contactRepository.findIdentityAliases(Array.from(uniqueJids));

    for (const alias of aliases) {
      const ident = alias.identity;
      if (ident) {
        if (ident.isMe) {
          nameMap.set(alias.jid, 'Me');
        } else if (!nameMap.has(alias.jid)) {
          const name = ident.displayName || ident.pushName || ident.verifiedName || alias.jid.split('@')[0];
          nameMap.set(alias.jid, name);
        }
      }
    }

    const chats = await this.chatRepository.findChatsByJids(Array.from(uniqueJids));

    const chatInfoMap = new Map<string, { name: string; type: string }>();
    for (const c of chats) {
      let name = c.name || '';
      if (c.type === 'DM') {
        name = nameMap.get(c.jid) || c.jid.split('@')[0];
      } else {
        name = c.name || c.jid.split('@')[0];
      }
      chatInfoMap.set(c.jid, { name, type: c.type });
    }

    return { nameMap, chatInfoMap };
  }

  private getSenderLabel(m: Message, isDM: boolean, nameMap: Map<string, string>): string {
    const participant = m.participant;
    if (m.fromMe || (participant && nameMap.get(participant) === 'Me')) {
      return 'Me';
    }
    if (isDM) return 'Them';
    if (!participant) return 'Unknown';
    return nameMap.get(participant) || participant.split('@')[0];
  }

  private getQuotedMessageContext(unwrapped: proto.IMessage | null | undefined): { quotedMsgId: string; participant: string; quotedText: string } | null {
    if (!unwrapped) return null;
    let contextInfo: proto.IContextInfo | null | undefined = null;
    const rawMsg = unwrapped as Record<string, unknown>;
    for (const key of Object.keys(rawMsg)) {
      const val = rawMsg[key];
      if (val && typeof val === 'object' && 'contextInfo' in val) {
        contextInfo = (val as { contextInfo?: proto.IContextInfo }).contextInfo;
        break;
      }
    }
    if (!contextInfo && rawMsg.contextInfo) {
      contextInfo = rawMsg.contextInfo as proto.IContextInfo;
    }
    if (!contextInfo || !contextInfo.stanzaId) return null;

    const quotedMsgId = contextInfo.stanzaId;
    const participant = contextInfo.participant || '';
    const quotedMessage = contextInfo.quotedMessage;

    let quotedText = '';
    if (quotedMessage) {
      const qUnwrapped = unwrapMessage(quotedMessage);
      const qType = getMessageType(qUnwrapped);
      quotedText = this.formatterRegistry.format(
        qUnwrapped,
        {
          messageType: qType,
          textContent: qUnwrapped?.conversation || qUnwrapped?.extendedTextMessage?.text || null
        },
        'transcript'
      );
    }

    return {
      quotedMsgId,
      participant,
      quotedText
    };
  }

  private getReplyContextString(unwrapped: proto.IMessage | null | undefined, nameMap: Map<string, string>, isDM: boolean): string {
    const quoted = this.getQuotedMessageContext(unwrapped);
    if (!quoted) return '';

    let sender = 'Unknown';
    if (quoted.participant) {
      const resolvedName = nameMap.get(quoted.participant);
      if (resolvedName === 'Me') {
        sender = 'Me';
      } else if (isDM) {
        sender = 'Them';
      } else {
        sender = resolvedName || quoted.participant.split('@')[0];
      }
    }

    const truncatedText = quoted.quotedText.replace(/\s+/g, ' ').trim();
    const limit = 35;
    const shortText = truncatedText.length > limit ? truncatedText.substring(0, limit) + '...' : truncatedText;

    return `(Reply to ${sender}: "${shortText}") `;
  }

  private formatMessageContent(m: Message, unwrapped: proto.IMessage | null | undefined): string {
    return this.formatterRegistry.format(
      unwrapped || null,
      {
        textContent: m.textContent,
        messageType: m.messageType,
        isDeleted: m.isDeleted
      },
      'transcript'
    );
  }
}
