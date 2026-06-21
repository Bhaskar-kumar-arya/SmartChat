import { AITool } from '../services/ai/IToolRegistry';
import { IMessageReadRepository } from '../services/messages/IMessageQueryRepository';
import { IRawSqlExecutor } from '../services/messages/IRawSqlExecutor';
import { IIdentityRepository } from '../services/contacts/IIdentityRepository';
import { IAliasRepository } from '../services/contacts/IAliasRepository';
import { IChatRepository } from '../services/chats/IChatRepository';
import { WASocket } from '../services/whatsapp/types';
import { unwrapMessage, getMessageType } from '../utils/messageUtils';
import { MessageFormatterRegistry } from '../services/messages/formatters/MessageFormatterRegistry';
import { Message } from '@prisma/client';
import { proto } from '@whiskeysockets/baileys';

// Keywords that are never allowed anywhere in the query
const FORBIDDEN_KEYWORDS = [
  'INSERT', 'UPDATE', 'DELETE', 'DROP', 'ALTER',
  'CREATE', 'ATTACH', 'DETACH', 'PRAGMA', 'VACUUM',
  'REPLACE', 'TRUNCATE', 'GRANT', 'REVOKE'
];

const KEYWORD_ME = 'Me';
const KEYWORD_THEM = 'Them';
const KEYWORD_UNKNOWN = 'Unknown';
const KEY_UNKNOWN_CHAT = 'unknown_chat';
const GROUP_JID_SUFFIX = '@g.us';
const CHAT_TYPE_DM = 'DM';
const CHAT_TYPE_GROUP = 'GROUP';
const FORMAT_TRANSCRIPT = 'transcript';
const LOCALE_EN_US = 'en-US';

const LIMIT_DEFAULT_MESSAGE = 100;
const LIMIT_MAX_MESSAGE = 20000;
const TRUNCATE_LIMIT_REPLY = 35;

interface ChatRun {
  chatJid: string;
  chatName: string;
  chatType: string;
  isDM: boolean;
  messages: Message[];
}

/**
 * Tool to read and format chat transcripts and message histories.
 *
 * Error handling contract:
 * - Throws Error prefixed with [ReadMessagesTool] for SQL errors, missing arguments, or invalid parameters.
 */
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
    private readonly messageRepository: IMessageReadRepository & IRawSqlExecutor,
    private readonly identityRepository: IIdentityRepository,
    private readonly aliasRepository: IAliasRepository,
    private readonly chatRepository: IChatRepository
  ) {}

  async execute(args: Record<string, unknown>): Promise<string> {
    const { messagesToFormat, isJidMode, hasMore } = await this.getMessagesFromArgs(args);
    const groupByChat = args.groupByChat as boolean | undefined;

    if (messagesToFormat.length === 0) {
      const jid = args.jid as string | undefined;
      return isJidMode ? `No messages found in chat ${jid}.` : 'No messages found.';
    }

    let finalMessages = messagesToFormat;
    if (groupByChat && !isJidMode) {
      finalMessages = this.sortMessagesByChat(messagesToFormat);
    }

    const { nameMap, chatInfoMap } = await this.resolveNamesAndChats(finalMessages);
    const chatRuns = this.buildChatRuns(finalMessages, nameMap, chatInfoMap);
    return this.formatChatRuns(chatRuns, isJidMode, hasMore, finalMessages, nameMap);
  }

  private async getMessagesFromArgs(args: Record<string, unknown>): Promise<{
    messagesToFormat: Message[];
    isJidMode: boolean;
    hasMore: boolean;
  }> {
    const jid = args.jid as string | undefined;
    const limit = args.limit as number | undefined;
    const messages = args.messages as Message[] | undefined;
    const sql = args.sql as string | undefined;
    const params = args.params as unknown[] | undefined;

    if (jid) {
      const { messagesToFormat, hasMore } = await this.getMessagesByJid(jid, limit);
      return {
        messagesToFormat,
        isJidMode: true,
        hasMore
      };
    }

    if (sql) {
      const messagesToFormat = await this.getMessagesBySql(sql, params);
      return {
        messagesToFormat,
        isJidMode: false,
        hasMore: false
      };
    }

    if (Array.isArray(messages)) {
      return {
        messagesToFormat: messages,
        isJidMode: false,
        hasMore: false
      };
    }

    throw new Error('[ReadMessagesTool] Missing required arguments: Provide jid, sql, or messages.');
  }

  private validateSqlQuery(sql: string): void {
    const trimmed = sql.trim();
    const normalized = trimmed.toUpperCase().replace(/\s+/g, ' ');

    if (!normalized.startsWith('SELECT') && !normalized.startsWith('WITH')) {
      throw new Error(
        `[ReadMessagesTool] Query rejected: Only SELECT or WITH...SELECT statements are allowed. Got: "${trimmed.slice(0, 40)}..."`
      );
    }

    for (const kw of FORBIDDEN_KEYWORDS) {
      const wordBoundaryRegex = new RegExp(`\\b${kw}\\b`);
      if (wordBoundaryRegex.test(normalized)) {
        throw new Error(
          `[ReadMessagesTool] Query rejected: Forbidden keyword detected — "${kw}". Only read operations are permitted.`
        );
      }
    }
  }

  private async getMessagesBySql(sql: string, params: unknown[] | undefined): Promise<Message[]> {
    const trimmed = sql.trim();
    this.validateSqlQuery(trimmed);

    const rows = await this.messageRepository.queryMessageIdsBySql(trimmed, Array.isArray(params) ? params : []);
    if (rows.length > 0 && !rows.some((r) => r.id !== undefined && r.id !== null)) {
      throw new Error('[ReadMessagesTool] Query rejected: The SQL query must return a column named "id" containing the message IDs.');
    }

    const msgIds = rows.map((r) => r.id as string).filter(Boolean);
    if (msgIds.length > 0) {
      const fetched = await this.messageRepository.findMessagesByIds(msgIds);
      const idToMsg = new Map(fetched.map(m => [m.id, m]));
      return msgIds.map(id => idToMsg.get(id)).filter((m): m is Message => m !== undefined);
    }
    return [];
  }

  private async getMessagesByJid(
    jid: string,
    limit: number | undefined
  ): Promise<{ messagesToFormat: Message[]; hasMore: boolean }> {
    const finalLimit = limit !== undefined ? Math.min(Math.max(1, limit), LIMIT_MAX_MESSAGE) : LIMIT_DEFAULT_MESSAGE;
    const fetched = await this.messageRepository.findMessagesByChat(jid, finalLimit + 1);
    const hasMore = fetched.length > finalLimit;
    const resultMessages = hasMore ? fetched.slice(0, finalLimit) : fetched;
    return {
      messagesToFormat: [...resultMessages].reverse(),
      hasMore
    };
  }

  private sortMessagesByChat(messages: Message[]): Message[] {
    const buckets = new Map<string, Message[]>();
    for (const m of messages) {
      const key = m.chatJid || KEY_UNKNOWN_CHAT;
      let bucket = buckets.get(key);
      if (!bucket) {
        bucket = [];
        buckets.set(key, bucket);
      }
      bucket.push(m);
    }

    const sortedKeys = Array.from(buckets.keys()).sort();
    return sortedKeys.flatMap(key => {
      const bucket = buckets.get(key);
      if (bucket) {
        bucket.sort((a, b) => Number(a.timestamp) - Number(b.timestamp));
        return bucket;
      }
      return [];
    });
  }

  private buildChatRuns(
    messagesToFormat: Message[],
    nameMap: Map<string, string>,
    chatInfoMap: Map<string, { name: string; type: string }>
  ): ChatRun[] {
    const chatRuns: ChatRun[] = [];
    let currentChatRun: ChatRun | null = null;

    for (const m of messagesToFormat) {
      const chatJid = m.chatJid || KEY_UNKNOWN_CHAT;
      const chatInfo = chatInfoMap.get(chatJid);
      const isDM = chatInfo ? chatInfo.type === CHAT_TYPE_DM : !chatJid.endsWith(GROUP_JID_SUFFIX);
      const chatName = chatInfo ? chatInfo.name : (nameMap.get(chatJid) || chatJid.split('@')[0]);
      const chatType = chatInfo ? chatInfo.type : (chatJid.endsWith(GROUP_JID_SUFFIX) ? CHAT_TYPE_GROUP : CHAT_TYPE_DM);

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
    return chatRuns;
  }

  private formatChatRuns(
    chatRuns: ChatRun[],
    isJidMode: boolean,
    hasMore: boolean,
    messagesToFormat: Message[],
    nameMap: Map<string, string>
  ): string {
    let formattedResponse = '';
    
    if (isJidMode) {
      formattedResponse += `Results for chat ${messagesToFormat[0]?.chatJid || ''}:\n`;
      formattedResponse += `Range: ${messagesToFormat.length} messages found.\n`;
      if (messagesToFormat.length > 0) {
        const oldest = messagesToFormat[0];
        const newest = messagesToFormat[messagesToFormat.length - 1];
        formattedResponse += `Newest Message ID: ${newest.id} (${this.formatDateTime(Number(newest.timestamp))})\n`;
        formattedResponse += `Oldest Message ID: ${oldest.id} (${this.formatDateTime(Number(oldest.timestamp))})\n`;
      }
      formattedResponse += `\n`;
      if (hasMore) {
        const oldest = messagesToFormat[0];
        formattedResponse += `> [... history continues before message ${oldest.id} ...]\n\n`;
      }
    } else {
      formattedResponse += `Results: ${messagesToFormat.length} messages.\n\n`;
    }

    for (const run of chatRuns) {
      if (run.messages.length <= 1) {
        formattedResponse += this.formatSingleMessageRun(run, nameMap);
      } else {
        formattedResponse += this.formatMultiMessageRun(run, nameMap);
      }
    }

    return formattedResponse;
  }

  private formatDateTime(ts: string | number): string {
    const date = new Date(Number(ts) * 1000);
    const dateStr = date.toLocaleDateString(LOCALE_EN_US, { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
    const timeStr = date.toLocaleTimeString();
    return `${dateStr} ${timeStr}`;
  }

  private formatDateOnly(ts: string | number): string {
    const date = new Date(Number(ts) * 1000);
    return date.toLocaleDateString(LOCALE_EN_US, { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
  }

  private formatSingleMessageRun(run: ChatRun, nameMap: Map<string, string>): string {
    let response = '';
    for (const m of run.messages) {
      const senderLabel = this.getSenderLabel(m, run.isDM, nameMap);
      const dateTimeStr = this.formatDateTime(Number(m.timestamp));
      
      let contentObj: Record<string, unknown> | null = null;
      try {
        contentObj = typeof m.content === 'string' ? JSON.parse(m.content) as Record<string, unknown> : m.content as Record<string, unknown>;
      } catch (e: unknown) {
        console.warn('[ReadMessagesTool] Failed to parse message content:', e);
      }
      const unwrapped = unwrapMessage(contentObj);
      
      const formattedContent = this.formatMessageContent(m, unwrapped);
      const replyContext = this.getReplyContextString(unwrapped, nameMap, run.isDM);
      
      response += `[Chat: ${run.chatName} (${run.chatType})] [${dateTimeStr}] ${senderLabel}: ${replyContext}${formattedContent}\n`;
    }
    return response;
  }

  private formatMultiMessageRun(run: ChatRun, nameMap: Map<string, string>): string {
    let response = `=== Chat: ${run.chatName} (${run.chatType}) (${run.chatJid}) ===\n`;

    interface DateGroup {
      dateStr: string;
      messages: Message[];
    }

    const dateGroups: DateGroup[] = [];
    let currentDateGroup: DateGroup | null = null;

    for (const m of run.messages) {
      const dateStr = this.formatDateOnly(Number(m.timestamp));
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
      response += `--- ${dGroup.dateStr} ---\n`;

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
        
        response += `[${firstTime}] ${sRun.senderLabel}:\n`;
        
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
          
          response += `  - [${timeStr}] ${replyContext}${formattedContent}\n`;
        }
      }
    }
    response += `\n`;
    return response;
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
    const meIdent = await this.identityRepository.findMeIdentity();
    if (meIdent) {
      for (const alias of meIdent.aliases) {
        nameMap.set(alias.jid, KEYWORD_ME);
      }
    }

    const aliases = await this.aliasRepository.findIdentityAliases(Array.from(uniqueJids));

    for (const alias of aliases) {
      const ident = alias.identity;
      if (ident) {
        if (ident.isMe) {
          nameMap.set(alias.jid, KEYWORD_ME);
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
      if (c.type === CHAT_TYPE_DM) {
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
    if (m.fromMe || (participant && nameMap.get(participant) === KEYWORD_ME)) {
      return KEYWORD_ME;
    }
    if (isDM) return KEYWORD_THEM;
    if (!participant) return KEYWORD_UNKNOWN;
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
        qUnwrapped as Record<string, any> | null | undefined,
        {
          messageType: qType,
          textContent: qUnwrapped?.conversation || qUnwrapped?.extendedTextMessage?.text || null
        },
        FORMAT_TRANSCRIPT
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

    let sender = KEYWORD_UNKNOWN;
    if (quoted.participant) {
      const resolvedName = nameMap.get(quoted.participant);
      if (resolvedName === KEYWORD_ME) {
        sender = KEYWORD_ME;
      } else if (isDM) {
        sender = KEYWORD_THEM;
      } else {
        sender = resolvedName || quoted.participant.split('@')[0];
      }
    }

    const truncatedText = quoted.quotedText.replace(/\s+/g, ' ').trim();
    const shortText = truncatedText.length > TRUNCATE_LIMIT_REPLY ? truncatedText.substring(0, TRUNCATE_LIMIT_REPLY) + '...' : truncatedText;

    return `(Reply to ${sender}: "${shortText}") `;
  }

  private formatMessageContent(m: Message, unwrapped: proto.IMessage | null | undefined): string {
    return this.formatterRegistry.format(
      (unwrapped || null) as Record<string, any> | null | undefined,
      {
        textContent: m.textContent,
        messageType: m.messageType,
        isDeleted: m.isDeleted
      },
      FORMAT_TRANSCRIPT
    );
  }
}
