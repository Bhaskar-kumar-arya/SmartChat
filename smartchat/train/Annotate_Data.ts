import { unwrapMessage, getMessageType } from '../src/main/utils/messageUtils';
import { createMessageFormatterRegistry } from '../src/main/services/messages/formatters';
import { proto } from '@whiskeysockets/baileys';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { execSync } from 'child_process';
import { GoogleGenAI, HarmCategory, HarmBlockThreshold } from '@google/genai';
import { setGlobalDispatcher, Agent } from 'undici';

// Configure global undici dispatcher to prevent HeadersTimeoutError during long LLM generation/prefill times
// connectTimeout: raised from the default 10 s to 60 s — avoids ConnectTimeoutError on slow/cold
// TCP handshakes to generativelanguage.googleapis.com (seen as "Connect Timeout Error, timeout: 10000ms")
setGlobalDispatcher(new Agent({
  connectTimeout: 60_000,
  headersTimeout: 900_000, // 15 minutes
  bodyTimeout:    900_000, // 15 minutes
}));



// ANSI escape codes for professional console styling
const colors = {
  reset: '\x1b[0m',
  bright: '\x1b[1m',
  dim: '\x1b[2m',
  blue: '\x1b[38;5;39m',
  cyan: '\x1b[38;5;87m',
  green: '\x1b[38;5;84m',
  yellow: '\x1b[38;5;220m',
  magenta: '\x1b[38;5;213m',
  red: '\x1b[38;5;203m',
  border: '\x1b[38;5;240m'
};

const KEYWORD_ME = 'Me';
const KEYWORD_THEM = 'Them';
const KEYWORD_UNKNOWN = 'Unknown';
const GROUP_JID_SUFFIX = '@g.us';
const FORMAT_TRANSCRIPT = 'transcript';
const TRUNCATE_LIMIT_REPLY = 35;
const MAX_MESSAGE_CHAR_LIMIT = 750; // gets truncated if larger
const MIN_MESSAGES_PER_CHAT = 10;
const MAX_MESSAGES_PER_CHAT = 100000;


const RPM_LIMIT = 15;           // N requests per minute limit
const MAX_CONCURRENCY = 10;     // Maximum simultaneous active requests across all chats
const MAX_CONCURRENT_CHATS = 5; // Maximum chats being annotated at the same time
const LAUNCH_INTERVAL = (60 * 1000) / RPM_LIMIT; // Minimum ms between request dispatches
const MAX_RETRIES = 15;          // Max attempts per window before giving up

// API KEY CONFIGURATION
const GEMINI_API_KEY = "AIzaSyDTfVHNlBOGLdgRSGISCPccYCq9-YLRGd0";

interface WindowSlice {
  windowIndex: number;
  startIndex: number;
  endIndex: number;
  messages: any[];
  formattedText: string;
  estimatedTokens: number;
}

/**
 * Executes a SQL query using the sqlite3 CLI and returns parsed JSON results.
 */
function runSql(dbPath: string, sql: string): any[] {
  const cleanSql = sql.replace(/\r?\n/g, ' ').replace(/\s+/g, ' ').trim();
  try {
    const escapedSql = cleanSql.replace(/"/g, '\\"');
    const output = execSync(`sqlite3 -json "${dbPath}" "${escapedSql}"`, { encoding: 'utf8', maxBuffer: 1024 * 1024 * 50 });
    if (!output.trim()) return [];
    return JSON.parse(output);
  } catch (err: any) {
    try {
      const escapedSql = cleanSql.replace(/"/g, '\\"');
      const output = execSync(`sqlite3 "${dbPath}" "${escapedSql}"`, { encoding: 'utf8' });
      return output.split('\n').filter(l => l.trim()).map(line => ({ value: line }));
    } catch (innerErr) {
      return [];
    }
  }
}

function getSenderLabel(m: any, isDM: boolean, nameMap: Map<string, string>): string {
  const participant = m.participant;
  if (m.fromMe || (participant && nameMap.get(participant) === KEYWORD_ME)) {
    return KEYWORD_ME;
  }
  if (isDM) return KEYWORD_THEM;
  if (!participant) return KEYWORD_UNKNOWN;
  return nameMap.get(participant) || participant.split('@')[0] || KEYWORD_UNKNOWN;
}

/**
 * Gets the fully-formatted text for a message (handles media, stickers, deleted, etc).
 */
function getFormattedText(m: any, formatterRegistry: any): string {
  let contentObj: Record<string, unknown> | null = null;
  try {
    contentObj = typeof m.content === 'string' ? JSON.parse(m.content) : (m.content || null);
  } catch (e) {
    // ignore
  }
  const unwrapped = unwrapMessage(contentObj);
  return formatMessageContent(m, unwrapped, formatterRegistry);
}

function getQuotedMessageContext(
  unwrapped: proto.IMessage | null | undefined,
  formatterRegistry: any
): { quotedMsgId: string; participant: string; quotedText: string } | null {
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
    quotedText = formatterRegistry.format(
      qUnwrapped as Record<string, any> | null | undefined,
      {
        messageType: qType,
        textContent: qUnwrapped?.conversation || qUnwrapped?.extendedTextMessage?.text || null
      },
      FORMAT_TRANSCRIPT
    );
  }

  return { quotedMsgId, participant, quotedText };
}

function getReplyContextString(
  unwrapped: proto.IMessage | null | undefined,
  nameMap: Map<string, string>,
  isDM: boolean,
  formatterRegistry: any
): string {
  const quoted = getQuotedMessageContext(unwrapped, formatterRegistry);
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

function formatMessageContent(m: any, unwrapped: proto.IMessage | null | undefined, formatterRegistry: any): string {
  return formatterRegistry.format(
    (unwrapped || null) as Record<string, any> | null | undefined,
    {
      textContent: m.textContent,
      messageType: m.messageType,
      isDeleted: m.isDeleted
    },
    FORMAT_TRANSCRIPT
  );
}

export function formatMessageForPrompt(
  index: number,
  m: any,
  unwrapped: proto.IMessage | null | undefined,
  nameMap: Map<string, string>,
  isDM: boolean,
  formatterRegistry: any
): string {
  const timeStr = new Date(Number(m.timestamp) * 1000).toLocaleTimeString();
  const senderLabel = getSenderLabel(m, isDM, nameMap);
  const rawContent = formatMessageContent(m, unwrapped, formatterRegistry);

  // Apply middle truncation if message content is too long
  let formattedContent = rawContent;
  if (rawContent.length > MAX_MESSAGE_CHAR_LIMIT) {
    const half = Math.floor((MAX_MESSAGE_CHAR_LIMIT - 3) / 2);
    formattedContent = rawContent.substring(0, half) + '...' + rawContent.substring(rawContent.length - half);
  }

  const replyContext = getReplyContextString(unwrapped, nameMap, isDM, formatterRegistry);

  return `[${index}] [${timeStr}] ${senderLabel}: ${replyContext}${formattedContent}`;
}



export function chunkMessagesIntoWindows(
  messages: any[],
  nameMap: Map<string, string>,
  isDM: boolean,
  formatterRegistry: any,
  targetTokenLimit = 8000,
  overlapCount = 20
): WindowSlice[] {
  const slices: WindowSlice[] = [];
  let i = 0;
  let windowIndex = 0;

  while (i < messages.length) {
    let currentWindowText = '';
    let currentTokens = 0;
    const windowMessages: any[] = [];
    let j = i;

    while (j < messages.length) {
      const msg = messages[j];
      let contentObj: Record<string, unknown> | null = null;
      try {
        contentObj = typeof msg.content === 'string' ? JSON.parse(msg.content) : msg.content;
      } catch (e) {
        // ignore
      }
      const unwrapped = unwrapMessage(contentObj);

      const relativeIndex = j - i;
      const formatted = formatMessageForPrompt(relativeIndex, msg, unwrapped, nameMap, isDM, formatterRegistry);
      const estMsgTokens = Math.ceil(formatted.length / 3.8);

      if (currentTokens + estMsgTokens > targetTokenLimit && windowMessages.length > 0) {
        break;
      }

      currentWindowText += formatted + '\n';
      currentTokens += estMsgTokens;
      windowMessages.push({ ...msg, relativeIndex });
      j++;
    }

    slices.push({
      windowIndex,
      startIndex: i,
      endIndex: j - 1,
      messages: windowMessages,
      formattedText: currentWindowText,
      estimatedTokens: currentTokens
    });

    windowIndex++;
    const windowSize = j - i;
    const advance = Math.max(1, windowSize - overlapCount);
    i += advance;

    if (j >= messages.length) break;
  }

  return slices;
}

function validateAnnotation(annotation: any, windowMsgCount: number): string[] {
  const errors: string[] = [];
  if (!annotation || typeof annotation !== 'object') {
    errors.push('Annotation is not an object');
    return errors;
  }
  if (!Array.isArray(annotation.links)) {
    errors.push('Annotation does not have "links" array');
    return errors;
  }

  const msgMap = new Set<number>();
  for (const link of annotation.links) {
    if (typeof link.msg !== 'number') {
      errors.push(`Link has non-number msg property: ${JSON.stringify(link)}`);
      continue;
    }
    if (link.msg < 0 || link.msg >= windowMsgCount) {
      errors.push(`Link msg index ${link.msg} is out of bounds [0, ${windowMsgCount - 1}]`);
    }
    if (msgMap.has(link.msg)) {
      errors.push(`Duplicate link entry for msg index ${link.msg}`);
    }
    msgMap.add(link.msg);

    if (link.replies_to !== null) {
      if (!Array.isArray(link.replies_to)) {
        errors.push(`msg ${link.msg} replies_to is not an array or null`);
      } else {
        for (const parent of link.replies_to) {
          if (typeof parent !== 'number') {
            errors.push(`msg ${link.msg} replies to non-number parent index: ${parent}`);
          } else if (parent < 0 || parent >= windowMsgCount) {
            errors.push(`msg ${link.msg} replies to out-of-bounds parent index: ${parent}`);
          } else if (parent >= link.msg) {
            errors.push(`msg ${link.msg} replies to future or self message index: ${parent}`);
          }
        }
      }
    }
  }

  for (let idx = 0; idx < windowMsgCount; idx++) {
    if (!msgMap.has(idx)) {
      errors.push(`Message index ${idx} is missing from the links array`);
    }
  }

  return errors;
}

function buildSeedThreadsFromQuoteReplies(
  allMessages: any[],
  formatterRegistry: any
): { seedEdges: Array<{ globalI: number; globalJ: number }> } {
  const msgIdToIndex = new Map<string, number>();
  for (let i = 0; i < allMessages.length; i++) {
    const m = allMessages[i];
    if (m.id) msgIdToIndex.set(m.id, i);
  }

  const seedEdges: Array<{ globalI: number; globalJ: number }> = [];

  for (let j = 0; j < allMessages.length; j++) {
    const m = allMessages[j];
    let contentObj: Record<string, unknown> | null = null;
    try {
      contentObj = typeof m.content === "string" ? JSON.parse(m.content) : m.content;
    } catch {
      // ignore
    }
    const unwrapped = unwrapMessage(contentObj);
    const quoted = getQuotedMessageContext(unwrapped, formatterRegistry);
    if (!quoted || !quoted.quotedMsgId) continue;

    const globalI = msgIdToIndex.get(quoted.quotedMsgId);
    if (globalI === undefined || globalI >= j) continue;

    seedEdges.push({ globalI, globalJ: j });
  }

  return { seedEdges };
}

/**
 * Global disjoint-set processing system that extracts and organizes entire historical message sequences 
 * grouped into localized chronological thread arrays.
 * Implements a "First Annotation Wins" guard to protect the graph from leading-edge context truncation.
 */
/**
 * Global disjoint-set processing system that extracts and organizes entire historical message sequences 
 * grouped into localized chronological thread arrays.
 * 
 * FIX 1: "First Annotation Wins" guard — prevents overlap re-annotation from overriding
 *         richer window-0 context with truncated leading-edge null assignments.
 * FIX 2: "Edge-Aware Dedup" — allows later windows to ADD new union edges for messages
 *         that were annotated as null in an earlier window due to limited context,
 *         while still blocking contradictory re-annotations of already-linked messages.
 */
function extractGlobalThreads(
  allMessages: any[],
  annotationsPath: string,
  nameMap: Map<string, string>,
  isDM: boolean,
  formatterRegistry: any,
  seedEdges: Array<{ globalI: number; globalJ: number }>,
  chatJid: string
): any[] {
  const parent = new Map<number, number>();

  const find = (x: number): number => {
    if (!parent.has(x)) parent.set(x, x);
    if (parent.get(x) !== x) parent.set(x, find(parent.get(x)!));
    return parent.get(x)!;
  };

  const union = (x: number, y: number) => {
    const px = find(x);
    const py = find(y);
    if (px !== py) parent.set(px, py);
  };

  // 1. Seed the graph with native WhatsApp quote-reply edges (ground truth, always trusted)
  for (const { globalI, globalJ } of seedEdges) {
    union(globalI, globalJ);
  }

  // Track which global message indices already have at least one outgoing union edge.
  const hasEstablishedEdge = new Set<number>();

  // Seed edges from native quote-replies count as established
  for (const { globalJ } of seedEdges) {
    hasEstablishedEdge.add(globalJ);
  }

  // 2. Integrate LLM annotation edges
  if (fs.existsSync(annotationsPath)) {
    const lines = fs.readFileSync(annotationsPath, 'utf8').split('\n').filter(l => l.trim());
    for (const line of lines) {
      try {
        const obj = JSON.parse(line);
        if (obj.chatJid !== chatJid) continue;
        const startIndex = obj.startIndex;
        const links = obj.annotation?.links || [];

        for (const link of links) {
          const globalJ = startIndex + link.msg;

          // Skip out-of-bounds global indices (safety check)
          if (globalJ < 0 || globalJ >= allMessages.length) continue;

          if (Array.isArray(link.replies_to) && link.replies_to.length > 0) {
            // This window wants to add edges for globalJ.
            // BLOCK if globalJ already has edges — a later window with less prior
            // context must not override an earlier window's established links.
            if (hasEstablishedEdge.has(globalJ)) continue;

            // ALLOW: globalJ was null in all prior windows, so this later window's
            // deeper context may have surfaced a real connection.
            for (const relParent of link.replies_to) {
              const globalI = startIndex + relParent;
              if (globalI < 0 || globalI >= allMessages.length) continue;
              if (globalI >= globalJ) continue; // enforce chronological constraint
              union(globalI, globalJ);
            }
            hasEstablishedEdge.add(globalJ);
          }
        }
      } catch (e) {
        // ignore malformed lines
      }
    }
  }

  // 3. Cluster all message indices under their disjoint-set root
  const threadGroups = new Map<number, number[]>();
  for (let i = 0; i < allMessages.length; i++) {
    const root = find(i);
    const group = threadGroups.get(root) || [];
    group.push(i);
    threadGroups.set(root, group);
  }

  // 4. Construct output thread objects
  const formattedThreads: any[] = [];
  for (const [rootId, indices] of threadGroups.entries()) {
    indices.sort((a, b) => a - b);

    const threadMessages = indices.map(idx => {
      const msg = allMessages[idx];
      return {
        globalIndex: idx,
        messageId: msg.id,
        timestamp: msg.timestamp,
        timeString: new Date(Number(msg.timestamp) * 1000).toLocaleTimeString(),
        sender: getSenderLabel(msg, isDM, nameMap),
        text: getFormattedText(msg, formatterRegistry)
      };
    });

    formattedThreads.push({
      threadId: rootId,
      messageCount: threadMessages.length,
      startedAt: new Date(Number(threadMessages[0].timestamp) * 1000).toISOString(),
      messages: threadMessages
    });
  }

  // 5. Sort threads chronologically by their first message
  formattedThreads.sort((a, b) => a.messages[0].timestamp - b.messages[0].timestamp);
  return formattedThreads;
}

async function main() {
  const __dirname = path.dirname(fileURLToPath(import.meta.url));
  let lastLaunchTime = 0;
  let dbPath = path.resolve(process.cwd(), 'prisma/dev.db');
  if (!fs.existsSync(dbPath)) {
    dbPath = path.resolve(__dirname, '../prisma/dev.db');
  }
  if (!fs.existsSync(dbPath)) {
    dbPath = path.resolve(__dirname, '../../prisma/dev.db');
  }
  const formatterRegistry = createMessageFormatterRegistry();

  console.log(`\n${colors.border}╔══════════════════════════════════════════════════════════════╗${colors.reset}`);
  console.log(`  ${colors.cyan}${colors.bright}🤖 SmartChat Chat Disentanglement Thread Extractor${colors.reset}`);
  console.log(`${colors.border}╚══════════════════════════════════════════════════════════════╝${colors.reset}\n`);

  const finalApiKey = process.env.GEMINI_API_KEY || GEMINI_API_KEY;
  if (!finalApiKey) {
    console.error(`${colors.red}❌ Error: Gemini API key is missing.${colors.reset}`);
    process.exit(1);
  }

  const ai = new GoogleGenAI({ apiKey: finalApiKey });

  const threadsDir = path.resolve(__dirname, 'threads');
  if (!fs.existsSync(threadsDir)) {
    fs.mkdirSync(threadsDir, { recursive: true });
  }

  const annotationsPath = path.resolve(__dirname, 'annotations.jsonl');

  // Load completed windows from annotations.jsonl to support automatic continue
  const completedWindows = new Set<string>();
  if (fs.existsSync(annotationsPath)) {
    const lines = fs.readFileSync(annotationsPath, 'utf8').split('\n');
    for (const line of lines) {
      if (line.trim()) {
        try {
          const obj = JSON.parse(line);
          if (obj.chatJid && typeof obj.windowIndex === 'number') {
            completedWindows.add(`${obj.chatJid}:${obj.windowIndex}`);
          }
        } catch (e) {}
      }
    }
  }

  console.log(`👥 Parsing contextual metadata configurations...`);
  const nameMap = new Map<string, string>();

  // 1. Map "me" aliases
  const meAliases = runSql(dbPath, `SELECT jid FROM IdentityAlias WHERE identityId IN (SELECT id FROM Identity WHERE isMe = 1);`);
  for (const row of meAliases) {
    nameMap.set(row.jid, KEYWORD_ME);
  }

  // 2. Map all other identities
  const allAliases = runSql(dbPath, `
    SELECT ia.jid, i.isMe, i.displayName, i.pushName, i.verifiedName 
    FROM IdentityAlias ia 
    LEFT JOIN Identity i ON ia.identityId = i.id;
  `);
  for (const row of allAliases) {
    if (row.isMe === 1) {
      nameMap.set(row.jid, KEYWORD_ME);
    } else if (!nameMap.has(row.jid)) {
      const name = row.displayName || row.pushName || row.verifiedName || row.jid.split('@')[0];
      nameMap.set(row.jid, name);
    }
  }

  console.log(`🔍 Querying active chats with >= ${MIN_MESSAGES_PER_CHAT} messages...`);
  const chatsResult = runSql(
    dbPath,
    `SELECT c.jid, c.name, c.type, COUNT(m.id) as messageCount
     FROM Chat c
     JOIN Message m ON c.jid = m.chatJid
     GROUP BY c.jid
     HAVING messageCount >= ${MIN_MESSAGES_PER_CHAT}
     ORDER BY messageCount DESC;`
  );

  console.log(`📊 Found ${colors.yellow}${chatsResult.length}${colors.reset} chats to process.\n`);

  const systemPrompt = `You are an expert dialogue thread analysis model specializing in chat disentanglement for WhatsApp group and DM conversations.

Your task is to analyze a chronological window of interleaved chat messages and produce a JSON structure that maps each message to the prior message(s) it directly continues — or marks it as starting a brand-new thread.

═══════════════════════════════════════════════
SECTION 1 — INPUT FORMAT
═══════════════════════════════════════════════

Messages are formatted as:
  [index] [HH:MM:SS AM/PM] SenderName: (Optional: Reply to SenderX: "quoted snippet...") message_content

Each message has:
- index        : Integer 0 to N-1 identifying position in the window.
- timestamp    : Exact local time of the message.
- SenderName   : Display name of the sender. Senders with identical names are the same person.
- Reply prefix : Present ONLY when the sender used WhatsApp's native quote-reply feature.
                 Format: (Reply to SenderX: "first 35 chars of the quoted message...")
                 This is a HARD EVIDENCE signal — do not ignore it.
- content      : The body of the message. Special tokens:
                   [Photo]   — an image was sent
                   [Video]   — a video was sent
                   [Sticker] — a sticker reaction was sent
                   [Audio]   — a voice note was sent
                   [Document]— a file was sent
                   [Contact] — a contact card was sent
                   (Message deleted) — message was retracted
  
  Note : if a messsage is too long , it is truncated from the mid of the text. ex. [long text start]...[long text end]. the ... represents truncation.

═══════════════════════════════════════════════
SECTION 2 — OUTPUT SCHEMA
═══════════════════════════════════════════════

Return a single valid JSON object with this exact shape:

{
  "links": [
    {
      "msg": <integer>,
      "reasoning": "<brief chain-of-thought before assigning replies_to>",
      "replies_to": <null | [integer, ...]>
    },
    ...
  ]
}

Rules:
- "links" must contain exactly one entry per message index (0 to N-1). No omissions, no duplicates.
- "msg" must equal the message's index in the window.
- "replies_to" is either null or a non-empty array of prior message indices.
  - Every element must be an integer strictly less than the current "msg" value.
  - No self-references (msg X cannot reply to X).
  - No forward references (msg X cannot reply to msg Y if Y > X).
- "reasoning" is mandatory. Write it BEFORE you commit to replies_to. It must:
  a) Name the candidate thread(s) you considered.
  b) Identify any explicit signals (quote-reply, @mention, keyword match).
  c) State your final conclusion before the JSON value.

RULE — Shared referential object (SRO)

Before assigning replies_to, ask: "What is this message ABOUT?"
Identify the specific entity, event, or artifact being discussed:
  - A piece of media (photo, video, sticker)
  - A person's location or action
  - A word, phrase, or typo from a prior message
  - An event (match, trip, deadline)

If two messages share the same SRO, they belong in the same thread
even across large time gaps and even if no single message directly
quotes or @mentions the other.

If a message's SRO cannot be identified in the current window at all
— it introduces a term, topic, or reference with no visible antecedent
— set replies_to = null.

Time gap between messages sharing an SRO is irrelevant. A question
about something in a photo sent 90 minutes ago is still about that photo.

═══════════════════════════════════════════════
SECTION 3 — LINKING DECISION FRAMEWORK
═══════════════════════════════════════════════

Use the following priority-ordered signals when assigning replies_to.

── LEVEL 1: HARD EVIDENCE (always follow these) ─────────────────
1. Native quote-reply block
   If a message starts with (Reply to SenderX: "…"), find the most recent
   prior message from SenderX whose content matches the quoted snippet.
   Set replies_to = [that message's index]. Do NOT guess another index.
  EXCEPTION TO LEVEL 1 — Quote-reply with topic pivot:
  If a message uses a native quote-reply but its content introduces a 
  completely unrelated subject (TB-1 applies), set replies_to = null.
  The quote-reply is acknowledgment of the prior message's existence,
  not continuation of its thread. The SRO of the new message determines 
  thread membership, not the mechanical quote target.

  Example: quoting a photo to say "btw did anyone see the match?" 
  → replies_to: null (new SRO: the match, not the photo)

2. @mention of a specific person
   If the message opens with "@Name …", set replies_to to the most recent
   message sent by that person.

── LEVEL 2: SOFT EVIDENCE (contextual inference) ─────────────────
3. Topical continuation
   The message directly continues or responds to the SPECIFIC subject, object,
   or question raised by a nearby prior message — not just the same general domain.
   "eco lecture at 8" replying to "anyone going tonight?" is continuation.
   "eco lecture at 8" appearing after a 15-minute sports discussion is NOT continuation of sports.

4. Temporal proximity
   Messages within ~60 seconds of each other from the SAME sender are likely
   a single burst and may be linked together if they read as sequential parts.
   Messages across a gap of 5+ minutes face a higher burden of proof to be linked.
   Gaps of 15+ minutes are strong candidates for thread breaks.

5. Pronoun / deictic reference
   Pronouns "it", "this", "that", "them" or deictic phrases "the one you sent",
   "your idea" carry reference only to a SPECIFIC recent antecedent visible in
   the window, not to a vague prior conversation.

── LEVEL 3: STRUCTURAL PATTERNS ─────────────────────────────────
6. Reaction / acknowledgment
   Short reactions ("lol", "ok", "nice", "😂", stickers) without other content
   reply to the most recent substantive message from a DIFFERENT sender — they
   are not independent threads.

7. Follow-up burst (same sender)
   Multiple messages from the same sender within ~90 seconds are usually a
   single thought split across sends. Link each subsequent one to the prior one
   from that sender (forming a chain), provided the topic has not shifted.

═══════════════════════════════════════════════
SECTION 4 — THREAD-BREAK RULES (when to assign null)
═══════════════════════════════════════════════

These are equally as important as the linking rules.
Set replies_to = null when ANY of the following apply:

RULE TB-1 — Topic pivot
   The message introduces a new subject with no clear semantic bridge to the
   recent prior messages. Even if it immediately follows an active thread, a
   completely different subject starts a new thread.
   Examples: switching from an economics debate to goodnight messages;
   switching from a meme to asking about event logistics.
   

RULE TB-2 — Unanchored messages

Set replies_to = null if the message has NO identifiable referent 
in the current window — no specific question it answers, no specific 
statement it continues, no person it addresses.

Time gap is a SIGNAL, not a rule:
- Large gap + no referent = strong null case
- Large gap + clear referent = still link (explicit wins always,
  implicit wins if the thread wasn't conclusively closed)
- Small gap + no referent = still null (topic pivot is TB-1)
- Small gap + clear referent = link

Never assign null solely because of elapsed time.
Never link solely because of temporal proximity.

RULE TB-3 — Group-level broadcast
   Messages like "gn everyone", "gm", "happy birthday", "who's coming to X?"
   addressed to the whole group, not a specific person or prior message,
   start a new thread.

RULE TB-4 — Generic reactions with no discernible antecedent
   A sticker, "[Photo]", or single emoji that arrives after a long silence (5+
   min) and cannot be traced to a specific prior message starts a new thread.

RULE TB-5 — Logistical / administrative non-sequitur
   A message about coordination, time, location, or task assignment that does
   not respond to any visible prior question about those topics is a new thread.

RULE TB-6 — Banter and tangential asides
   Teasing, wordplay, or off-topic jokes triggered by a SPECIFIC prior message
   are linked to that message (not null). But if the joke or banter has no
   traceable trigger in the current window, use null.

IMPORTANT: A message being sent by the same person who sent the previous
message does NOT automatically make it a continuation. Evaluate content,
topic, and time independently.

ANTI-PATTERN — "Gradual drift" trap
The model must NOT merge a slow-moving conversation into one thread
just because no single step felt like a hard break. If a chain of
messages crosses 60+ minutes total from first to last, re-check
every gap inside it. At least one of those gaps will qualify for
TB-2. Apply it.

ANTI-PATTERN — "Same group" trap  
All messages in a group chat are from "the same group". This is never
a reason to link. Link only on message-level signals, not group-level
social context.

═══════════════════════════════════════════════
SECTION 5 — MEDIA AND SPECIAL CONTENT RULES
═══════════════════════════════════════════════

- [Photo] / [Video] / [Document] following a question about something visual
  or requested: link to the question. Otherwise: start new thread (null).
- [Sticker] as a direct reaction: link to the most recent message it reacts to.
- [Sticker] in isolation after a long gap: null.
- (Message deleted): almost always null — it has no recoverable content.
  Exception: if it is immediately sandwiched between messages clearly in
  the same thread and the gap is under 30 seconds, link it to the prior message.
- [Audio]: treat like a regular text message. Infer thread by sender and timing.

═══════════════════════════════════════════════
SECTION 6 — LANGUAGE AND ENCODING NOTES
═══════════════════════════════════════════════

Messages may contain:
- Hinglish (Hindi written in Latin script), romanised Urdu, Tamil, Bengali, etc.
- Code-switching mid-message (e.g., "bhai yaar it's not about the cost")
- Abbreviations, typos, autocorrect errors (e.g., "mia" → "mai" in the next message)
- Missing punctuation, run-on words

These are not errors — they are natural vernacular. Evaluate semantic continuity
as you would standard English. A typo-correction message ("mai*") is a follow-up
burst from the same sender and links to the message it corrects.

═══════════════════════════════════════════════
SECTION 7 — FEW-SHOT GOLD STANDARD EXAMPLES
═══════════════════════════════════════════════

EXAMPLE A — Multi-thread group chat with topic pivots, temporal gaps, goodnight burst, and banter
(This is the primary reference. Study every thread break and every link.)

INPUT:
[0]  [10:31 PM] Sanchit: aa rahe hai bhai
[1]  [10:32 PM] Sanchit: dw ek banda joke kar raha tha
[2]  [11:12 PM] Ayaan: [Sticker]
[3]  [11:12 PM] ‎: [Sticker]
[4]  [11:15 PM] Manay: [Photo]
[5]  [11:15 PM] Manay: [Photo]
[6]  [11:15 PM] Ayaan: 😂
[7]  [11:16 PM] ‎: exactly
[8]  [11:16 PM] Devbrat: its not about the cost, its about how much the consumers are willing to give for it
[9]  [11:17 PM] ‎: no, its how much the producers are willing to sell it at
[10] [11:17 PM] ‎: bro consumers are willing to give like 40
[11] [11:17 PM] Devbrat: how much
[12] [11:17 PM] Devbrat: they can give 30, 40, 50
[13] [11:18 PM] Devbrat: whats the limit
[14] [11:18 PM] ‎: 49.5
[15] [11:18 PM] Devbrat: fucking hell dont make me do calc and eco at the same time
[16] [11:18 PM] ‎: hmm
[17] [11:18 PM] ‎: same shit
[18] [11:20 PM] ‎: Send on campus
[19] [11:29 PM] Manay: I am not on campus 😞😭
[20] [11:30 PM] ‎: sent it , dw
[21] [11:30 PM] ‎: @Manay pls drop an another banger
[22] [11:44 PM] arnav: nini time
[23] [11:45 PM] Deepak: Good night guys
[24] [11:45 PM] ‎: night
[25] [11:45 PM] Devbrat: ok
[26] [11:46 PM] ‎: 14min aya mia
[27] [11:46 PM] ‎: mai*
[28] [11:46 PM] Devbrat: mia
[29] [11:46 PM] Deepak: I'll be waiting
[30] [11:46 PM] ‎: ok
[31] [11:46 PM] ‎: yes

EXPECTED OUTPUT:
{
  "links": [
    {
      "msg": 0,
      "reasoning": "No prior context. Sanchit's first message opens a new conversational thread.",
      "replies_to": null
    },
    {
      "msg": 1,
      "reasoning": "Same sender (Sanchit), ~60 second gap, 'dw' (don't worry) directly qualifies msg 0's arrival update. Follow-up burst.",
      "replies_to": [0]
    },
    {
      "msg": 2,
      "reasoning": "40-minute gap (TB-2). No quote-reply, no mention. Sanchit's thread is cold. Sticker arrives cold — new thread.",
      "replies_to": null
    },
    {
      "msg": 3,
      "reasoning": "Same sticker exchange 43 seconds later. Likely a mirrored sticker reaction to msg 2.",
      "replies_to": [2]
    },
    {
      "msg": 4,
      "reasoning": "3-minute gap, new sender (Manay), completely different content type. TB-1 (topic pivot). New thread.",
      "replies_to": null
    },
    {
      "msg": 5,
      "reasoning": "Same sender (Manay), ~4 seconds after msg 4, second photo in a burst. Follow-up burst — links to msg 4.",
      "replies_to": [4]
    },
    {
      "msg": 6,
      "reasoning": "Ayaan reacts with 😂 to Manay's photos (msgs 4–5) within 9 seconds. Reaction to the most recent substantive content.",
      "replies_to": [5]
    },
    {
      "msg": 7,
      "reasoning": "'exactly' from unnamed sender — single-word agreement, 23 seconds after Ayaan's laugh. Continues the same photo reaction chain.",
      "replies_to": [6]
    },
    {
      "msg": 8,
      "reasoning": "Devbrat introduces an economics/pricing argument out of nowhere, 36 seconds after msg 7. Topic pivot (TB-1). New thread.",
      "replies_to": null
    },
    {
      "msg": 9,
      "reasoning": "Directly disputes Devbrat's economic claim ('no, its how much the producers…'). Counters msg 8.",
      "replies_to": [8]
    },
    {
      "msg": 10,
      "reasoning": "Same unnamed sender, 27 seconds later, provides data ('consumers are willing to give like 40') supporting their rebuttal. Continues msg 9.",
      "replies_to": [9]
    },
    {
      "msg": 11,
      "reasoning": "Devbrat asks 'how much' — a direct interrogative following the '40' figure in msg 10. Links to msg 10.",
      "replies_to": [10]
    },
    {
      "msg": 12,
      "reasoning": "Devbrat's follow-up burst answers his own implicit question, elaborating on consumer willingness ranges. Links to msg 11.",
      "replies_to": [11]
    },
    {
      "msg": 13,
      "reasoning": "Devbrat continues the same burst asking 'whats the limit' — directly extends msg 12.",
      "replies_to": [12]
    },
    {
      "msg": 14,
      "reasoning": "Unnamed sender answers '49.5' — a direct numeric answer to Devbrat's 'whats the limit' at msg 13.",
      "replies_to": [13]
    },
    {
      "msg": 15,
      "reasoning": "Devbrat's exasperated reaction to having to do calc and eco simultaneously — triggered by '49.5' at msg 14.",
      "replies_to": [14]
    },
    {
      "msg": 16,
      "reasoning": "Unnamed sender's 'hmm' within 8 seconds of msg 15 — acknowledgment of Devbrat's frustration. Links to msg 15.",
      "replies_to": [15]
    },
    {
      "msg": 17,
      "reasoning": "'same shit' — the sender commiserates with Devbrat's dual-subject pain. Continues msg 16 (same sender, 2 seconds, topic-same).",
      "replies_to": [16]
    },
    {
      "msg": 18,
      "reasoning": "2-minute gap. 'Send on campus' is a logistics request — completely different subject from the eco debate. TB-1 + TB-5. New thread.",
      "replies_to": null
    },
    {
      "msg": 19,
      "reasoning": "9-minute gap, but Manay directly responds to the campus request at msg 18 ('I am not on campus'). Explicit topical reply.",
      "replies_to": [18]
    },
    {
      "msg": 20,
      "reasoning": "Unnamed sender says 'sent it, dw' — confirming the campus item was sent, resolving msg 18's request.",
      "replies_to": [18]
    },
    {
      "msg": 21,
      "reasoning": "Same sender, 2 seconds later. @Manay mention — links to most recent Manay message (msg 19). Burst within campus thread.",
      "replies_to": [19]
    },
    {
      "msg": 22,
      "reasoning": "14-minute gap (TB-2). 'nini time' (goodnight) — group broadcast, topic pivot. TB-1 + TB-3. New thread.",
      "replies_to": null
    },
    {
      "msg": 23,
      "reasoning": "'Good night guys' — Deepak joins the goodnight broadcast. Links to msg 22 as part of the same farewell thread.",
      "replies_to": [22]
    },
    {
      "msg": 24,
      "reasoning": "'night' — another participant echoes the goodnight. Continues the farewell thread from msg 22.",
      "replies_to": [22]
    },
    {
      "msg": 25,
      "reasoning": "'ok' from Devbrat, 5 seconds after 'night'. Short acknowledgment of the goodnight chain. Links to msg 22.",
      "replies_to": [22]
    },
    {
      "msg": 26,
      "reasoning": "1 minute later. '14min aya mia' — unnamed sender notes arrival. No clear reference to goodnight messages; 'mia' is a typo of 'mai' (corrected in msg 27). This is a new topic (arrival update). TB-1. New thread.",
      "replies_to": null
    },
    {
      "msg": 27,
      "reasoning": "Same sender, 2 seconds later. 'mai*' is a typo correction for 'mia' in msg 26. Follow-up burst correction. Links to msg 26.",
      "replies_to": [26]
    },
    {
      "msg": 28,
      "reasoning": "Devbrat teases the typo 'mia' — directly references the error at msg 26. Banter triggered by a specific prior message. Links to msg 26.",
      "replies_to": [26]
    },
    {
      "msg": 29,
      "reasoning": "Deepak says 'I'll be waiting' — responding to the arrival announcement at msg 26 ('14 min away'). Links to msg 26.",
      "replies_to": [26]
    },
    {
      "msg": 30,
      "reasoning": "'ok' — unnamed sender acknowledges. Placed after Deepak's 'I'll be waiting' at msg 29, within the arrival sub-thread.",
      "replies_to": [29]
    },
    {
      "msg": 31,
      "reasoning": "'yes' — unnamed sender confirms. Links to msg 30.",
      "replies_to": [30]
    }
  ]
}

───────────────────────────────────────────────
EXAMPLE B — Interleaved multi-topic group chat with explicit quote-replies and @mentions
(Shorter example showing classic cross-talk disentanglement)

INPUT:
[0]  [11:15 AM] Rohit: did anyone get the solution for question 3?
[1]  [11:15 AM] Sneha: (Reply to Rohit: "did anyone get the solution for q...") i solved it, modified binary search
[2]  [11:15 AM] Akash: [Photo]  what do you guys think of this jacket?
[3]  [11:16 AM] Sneha: looks clean bro, price?
[4]  [11:16 AM] Rohit: (Reply to Sneha: "i solved it, modified binary sear...") can you share the proof snippet?
[5]  [11:16 AM] Akash: (Reply to Sneha: "looks clean bro, price?") 3k on sale off Myntra
[6]  [11:16 AM] Kabir: @Akash skip it, looks mid tbh
[7]  [11:17 AM] Sneha: @Rohit wait, opening laptop
[8]  [11:17 AM] Kabir: (Message deleted)
[9]  [11:18 AM] Akash: [Sticker]

EXPECTED OUTPUT:
{
  "links": [
    {
      "msg": 0,
      "reasoning": "First message in window. Assignment thread opener.",
      "replies_to": null
    },
    {
      "msg": 1,
      "reasoning": "Native quote-reply prefix citing Rohit's question 3 message (msg 0). Hard evidence — links to msg 0.",
      "replies_to": [0]
    },
    {
      "msg": 2,
      "reasoning": "Same timestamp cluster but completely different topic (fashion, not assignments). TB-1. New thread.",
      "replies_to": null
    },
    {
      "msg": 3,
      "reasoning": "Sneha asks 'price?' — directly responds to the jacket photo at msg 2. No assignment connection.",
      "replies_to": [2]
    },
    {
      "msg": 4,
      "reasoning": "Native quote-reply citing Sneha's binary search answer at msg 1. Hard evidence — assignment thread continues.",
      "replies_to": [1]
    },
    {
      "msg": 5,
      "reasoning": "Native quote-reply citing Sneha's 'looks clean bro, price?' at msg 3. Hard evidence — jacket thread continues.",
      "replies_to": [3]
    },
    {
      "msg": 6,
      "reasoning": "@Akash mention — links to most recent Akash message (msg 5, or trace back to msg 2 as topic root). Jacket thread.",
      "replies_to": [2]
    },
    {
      "msg": 7,
      "reasoning": "@Rohit mention — links to Rohit's most recent message (msg 4, the request for proof). Assignment thread.",
      "replies_to": [4]
    },
    {
      "msg": 8,
      "reasoning": "(Message deleted). 30-second gap, sandwiched in the jacket discussion cluster. Links to the most recent jacket message (msg 6).",
      "replies_to": [6]
    },
    {
      "msg": 9,
      "reasoning": "Sticker reaction from Akash. Likely reacts to Kabir's 'mid' comment at msg 6 (jacket banter). Links to msg 6.",
      "replies_to": [6]
    }
  ]
}

═══════════════════════════════════════════════
SECTION 8 — QUALITY CHECKLIST (run before finalizing output)
═══════════════════════════════════════════════

Before writing the final JSON, verify:

[ ] Every index 0 to N-1 has exactly one entry in "links".
[ ] No replies_to value is >= the current msg index.
[ ] Every native quote-reply has been mapped to the correct antecedent.
[ ] Temporal gaps of 15+ min without continuation signal got null.
[ ] Topic pivots (new subject, no bridge) got null — even between close messages.
[ ] Same-sender rapid bursts are chained (each links to prior from same sender).
[ ] Short reactions (emoji, ok, lol, sticker) link to most recent substantive message.
[ ] Group broadcasts (gm, gn, birthday) got null.
[ ] Typo corrections link to the message being corrected.
[ ] Multi-topic interleaving is correctly separated (assignment ≠ jacket ≠ logistics).

Output only the raw JSON object. Do not include markdown fences, explanatory prose, or any text outside the JSON structure.`;

  // ── Phase 1: Load all chat messages and build per-chat window lists ──────────

  interface ChatContext {
    chat: any;
    safeChatName: string;
    threadsJsonPath: string;
    messages: any[];
    isDM: boolean;
    windows: WindowSlice[];
    totalWindows: number;
  }

  interface PendingTask {
    w: WindowSlice;
    chatJid: string;
    totalWindows: number;
  }

  const chatContexts: ChatContext[] = [];
  const allPendingTasks: PendingTask[] = [];

  for (let chatIdx = 0; chatIdx < chatsResult.length; chatIdx++) {
    const chat = chatsResult[chatIdx];
    const safeChatName = chat.name || nameMap.get(chat.jid) || chat.jid.split('@')[0];
    const threadsJsonPath = path.resolve(threadsDir, `${chat.jid}.json`);

    console.log(`--- [Chat ${chatIdx + 1}/${chatsResult.length}] Loading ${colors.yellow}${safeChatName}${colors.reset} (${chat.jid}) ---`);

    if (fs.existsSync(threadsJsonPath)) {
      console.log(`⏭️ Threads file already exists for this chat. Skipping.\n`);
      continue;
    }

    console.log(`📨 Fetching chronological log streams...`);
    const rawMessages = runSql(
      dbPath,
      `SELECT id, chatJid, senderId, participant, fromMe, timestamp, messageType, content, textContent, isDeleted, isEdited, status 
       FROM Message WHERE chatJid = '${chat.jid}' ORDER BY timestamp ASC LIMIT ${MAX_MESSAGES_PER_CHAT};`
    );

    const messages = rawMessages.map((m: any) => ({
      ...m,
      fromMe: m.fromMe === 1,
      isDeleted: m.isDeleted === 1,
      isEdited: m.isEdited === 1,
      timestamp: Number(m.timestamp)
    }));

    if (messages.length < MIN_MESSAGES_PER_CHAT) {
      console.log(`⏭️ Chat has less than ${MIN_MESSAGES_PER_CHAT} messages. Skipping.\n`);
      continue;
    }

    const isDM = !chat.jid.endsWith(GROUP_JID_SUFFIX);

    console.log(`📦 Organizing streams into optimization boundary blocks...`);
    const windows = chunkMessagesIntoWindows(messages, nameMap, isDM, formatterRegistry, 2000, 20);
    console.log(`🧩 Analysis partition slots: ${colors.yellow}${windows.length}${colors.reset}\n`);

    chatContexts.push({ chat, safeChatName, threadsJsonPath, messages, isDM, windows, totalWindows: windows.length });

    for (const w of windows) {
      if (!completedWindows.has(`${chat.jid}:${w.windowIndex}`)) {
        allPendingTasks.push({ w, chatJid: chat.jid, totalWindows: windows.length });
      }
    }
  }

  // ── Phase 2: Build per-chat pending counters + thread-extraction helper ──────


  // ── Error classification ──────────────────────────────────────────────────────
  // Returns the error category so the retry loop can apply the right strategy:
  //   'retryable'    — transient server/network error (500, 502, 503, fetch failed)
  //                    → exponential backoff retry
  //   'rate-limited' — 429 Too Many Requests
  //                    → long fixed pause then retry
  //   'fatal'        — client error (400, 401, 403, 404 …) or parse failure
  //                    → give up immediately, no retry
  function classifyError(err: unknown): 'retryable' | 'rate-limited' | 'fatal' {
    if ((err as any)?.isFatalSafetyBlock) return 'fatal';
    if (!(err instanceof Error)) return 'retryable';
    const msg = err.message;

    // Network-layer failures are always retryable
    if (
      msg.includes('fetch failed') ||
      msg.includes('ECONNRESET') ||
      msg.includes('ETIMEDOUT') ||
      msg.includes('ENOTFOUND') ||
      msg.includes('socket hang up') ||
      msg.includes('network error') ||
      msg.includes('Timeout') || 
      err.name === 'HeadersTimeoutError'
    ) return 'retryable';

    // Try to extract HTTP status code from ApiError JSON embedded in the message
    try {
      const match = msg.match(/\{.*\}/s);
      if (match) {
        const parsed = JSON.parse(match[0]);
        const code: number = parsed?.error?.code ?? 0;
        if (code === 429) return 'rate-limited';
        if (code >= 500) return 'retryable';   // 5xx — transient server error
        if (code >= 400) return 'fatal';        // 4xx — bad request, auth error, etc.
      }
    } catch { /* ignore JSON parse failure */ }

    // Unknown error — assume transient
    return 'retryable';
  }

  // Exponential backoff delay for retryable errors (2 s → 4 s → 8 s → 16 s → 32 s, capped)
  function retryDelay(attempt: number): number {
    const base = 2000;
    const cap  = 32_000;
    const jitter = Math.random() * 1000;
    return Math.min(base * Math.pow(2, attempt - 1), cap) + jitter;
  }

  // Map chatJid → number of windows still awaiting annotation
  const chatPendingCount = new Map<string, number>();
  // Map chatJid → its ChatContext (for quick lookup inside callbacks)
  const chatContextByJid = new Map<string, ChatContext>();

  for (const ctx of chatContexts) {
    const pendingCount = ctx.windows.filter(
      w => !completedWindows.has(`${ctx.chat.jid}:${w.windowIndex}`)
    ).length;
    chatPendingCount.set(ctx.chat.jid, pendingCount);
    chatContextByJid.set(ctx.chat.jid, ctx);
  }

  // Runs thread extraction for a single chat and writes its threads JSON.
  // Called as soon as the last window for a chat is annotated (or immediately
  // if it had zero pending windows), so each chat is unblocked independently.
  function extractAndSaveThreads(ctx: ChatContext): void {
    const { chat, safeChatName, threadsJsonPath, messages, isDM } = ctx;
    console.log(`\n--- 🔗 Thread extraction: ${colors.yellow}${safeChatName}${colors.reset} (${chat.jid}) ---`);

    console.log(`🔍 Parsing contextual reference points from native reply targets...`);
    const { seedEdges } = buildSeedThreadsFromQuoteReplies(messages, formatterRegistry);

    console.log(`🔗 Executing unified graph union passes across tracking components...`);
    const globalThreads = extractGlobalThreads(
      messages,
      annotationsPath,
      nameMap,
      isDM,
      formatterRegistry,
      seedEdges,
      chat.jid
    );

    fs.writeFileSync(threadsJsonPath, JSON.stringify(globalThreads, null, 2), 'utf8');

    console.log(`${colors.green}🚀 Thread extraction complete for chat!${colors.reset}`);
    console.log(`📊 Total Continuous Threads Formed : ${colors.yellow}${globalThreads.length}${colors.reset}`);
    console.log(`📁 Target Output Workspace Storage: ${colors.cyan}${threadsJsonPath}${colors.reset}\n`);
  }

  // Fire thread extraction immediately for any chat that already had all its
  // windows annotated in a previous run (0 pending tasks this session).
  for (const ctx of chatContexts) {
    if (chatPendingCount.get(ctx.chat.jid) === 0) {
      extractAndSaveThreads(ctx);
    }
  }

  // ── Phase 3: Global rate-limited parallel pool with per-chat concurrency ──────

  // Group pending tasks by chat so we can activate MAX_CONCURRENT_CHATS at a time.
  // Tasks within each chat preserve their natural window order.
  const chatJidsWithTasks: string[] = [];
  const tasksByChat = new Map<string, PendingTask[]>();
  for (const task of allPendingTasks) {
    if (!tasksByChat.has(task.chatJid)) {
      chatJidsWithTasks.push(task.chatJid);
      tasksByChat.set(task.chatJid, []);
    }
    tasksByChat.get(task.chatJid)!.push(task);
  }

  // dispatchQueue holds tasks whose chats are currently "active" (allowed to run).
  // activateNextChats() tops it up whenever a chat slot becomes free.
  const activeChats = new Set<string>();
  const dispatchQueue: PendingTask[] = [];
  let chatCursor = 0;

  function activateNextChats(): void {
    while (activeChats.size < MAX_CONCURRENT_CHATS && chatCursor < chatJidsWithTasks.length) {
      const jid = chatJidsWithTasks[chatCursor++];
      activeChats.add(jid);
      const tasks = tasksByChat.get(jid) ?? [];
      dispatchQueue.push(...tasks);
      const shortJid = jid.split('@')[0];
      console.log(`🟢 Activating chat ${colors.cyan}${shortJid}${colors.reset} (${tasks.length} windows queued). Active chats: ${activeChats.size}/${MAX_CONCURRENT_CHATS}`);
    }
  }

  function logAnnotationError(
    chatJid: string,
    windowIndex: number,
    attempt: number,
    error: any,
    rawResponse: string,
    responseObj?: any
  ): void {
    const logDir = path.dirname(fileURLToPath(import.meta.url));
    const logPath = path.resolve(logDir, 'annotation_errors.jsonl');

    const finishReason = responseObj?.candidates?.[0]?.finishReason;
    const safetyRatings = responseObj?.candidates?.[0]?.safetyRatings;

    const logEntry = {
      timestamp: new Date().toISOString(),
      chatJid,
      windowIndex,
      attempt,
      error: {
        name: error instanceof Error ? error.name : 'UnknownError',
        message: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : undefined,
      },
      finishReason,
      safetyRatings,
      rawResponseLength: rawResponse?.length || 0,
      rawResponse: rawResponse,
      responseRaw: responseObj,
    };

    try {
      fs.appendFileSync(logPath, JSON.stringify(logEntry) + '\n', 'utf8');
    } catch (writeErr) {
      console.error('Failed to write to annotation_errors.jsonl:', writeErr);
    }
  }

  async function executeWindowTask(w: WindowSlice, chatJid: string, totalWindows: number): Promise<void> {
    console.log(`[Chat ${chatJid.split('@')[0]} | Window ${w.windowIndex + 1}/${totalWindows}] Evaluating indices ${w.startIndex}–${w.endIndex}`);

    const userPrompt = `Analyze the following chat window and output the JSON links structure:\n\n${w.formattedText}\n\nJSON Output:`;

    let success = false;
    let attempt = 0;
    let parsedAnnotation: any = null;

    while (!success && attempt < MAX_RETRIES) {
      let response: any = null;
      let rawResponse = '';
      try {
        // Coordinate rate limiting slot reservation globally (accounts for both launches and retries)
        const now = Date.now();
        const targetTime = Math.max(now, (lastLaunchTime === 0 ? now : lastLaunchTime + LAUNCH_INTERVAL));
        lastLaunchTime = targetTime;

        if (targetTime > now) {
          await new Promise(resolve => setTimeout(resolve, targetTime - now));
        }

        response = await ai.models.generateContent({
          model: 'gemma-4-31b-it',
          contents: userPrompt,
          config: {
            systemInstruction: systemPrompt,
            responseMimeType: 'application/json',
            safetySettings: [
              { category: HarmCategory.HARM_CATEGORY_HARASSMENT, threshold: HarmBlockThreshold.BLOCK_NONE },
              { category: HarmCategory.HARM_CATEGORY_HATE_SPEECH, threshold: HarmBlockThreshold.BLOCK_NONE },
              { category: HarmCategory.HARM_CATEGORY_SEXUALLY_EXPLICIT, threshold: HarmBlockThreshold.BLOCK_NONE },
              { category: HarmCategory.HARM_CATEGORY_DANGEROUS_CONTENT, threshold: HarmBlockThreshold.BLOCK_NONE },
              { category: HarmCategory.HARM_CATEGORY_CIVIC_INTEGRITY, threshold: HarmBlockThreshold.BLOCK_NONE }
            ]
          }
        });

        rawResponse = response.text || '';
        if (!rawResponse.trim()) {
          const blockReason = response?.promptFeedback?.blockReason;
          if (blockReason === 'PROHIBITED_CONTENT' || blockReason === 'SAFETY') {
            const fatalErr = new Error(`Prompt blocked by Gemini safety filter. Block reason: ${blockReason}`);
            (fatalErr as any).isFatalSafetyBlock = true;
            throw fatalErr;
          }
          const finishReason = response?.candidates?.[0]?.finishReason;
          throw new Error(`Empty response received from Gemini. Finish reason: ${finishReason || 'UNKNOWN'}`);
        }

        parsedAnnotation = JSON.parse(rawResponse.trim());

        const errors = validateAnnotation(parsedAnnotation, w.messages.length);
        if (errors.length > 0) {
          throw new Error(`Validation failed: ${errors[0]}`);
        }
        success = true;

      } catch (err) {
        attempt++;
        logAnnotationError(chatJid, w.windowIndex, attempt, err, rawResponse, response);

        const kind = classifyError(err);
        const causeStr = (err instanceof Error && 'cause' in err && err.cause) ? ` (Cause: ${err.cause})` : '';

        if (kind === 'fatal') {
          // 4xx client errors won't be fixed by retrying — bail out immediately
          console.error(`${colors.red}❌ [${chatJid.split('@')[0]}] Window ${w.windowIndex + 1} non-retryable error: ${err}${causeStr}${colors.reset}`);
          break;
        }

        if (attempt >= MAX_RETRIES) break;

        const delay = kind === 'rate-limited'
          ? 60_000 + Math.random() * 5_000   // 429 → wait ~60 s before retry
          : retryDelay(attempt);              // 5xx / network → exponential backoff

        const kindLabel = kind === 'rate-limited' ? '429 rate-limited' : kind;
        console.warn(`${colors.yellow}⚠ [${chatJid.split('@')[0]}] Window ${w.windowIndex + 1} ${kindLabel} (attempt ${attempt}/${MAX_RETRIES}). Retrying in ${Math.round(delay / 1000)}s… Error: ${err}${causeStr}${colors.reset}`);
        await new Promise(res => setTimeout(res, delay));
      }
    }

    if (!success) {
      console.error(`${colors.red}❌ [${chatJid.split('@')[0]}] Window ${w.windowIndex + 1} gave up after ${attempt} attempt(s).${colors.reset}`);
      // Still decrement so a partially-failed chat eventually reaches 0 and gets extracted
    } else {
      const annotationLog = {
        chatJid,
        windowIndex: w.windowIndex,
        startIndex: w.startIndex,
        endIndex: w.endIndex,
        annotation: parsedAnnotation
      };
      fs.appendFileSync(annotationsPath, JSON.stringify(annotationLog) + '\n', 'utf8');
      console.log(`${colors.green}✅ [${chatJid.split('@')[0]}] Window ${w.windowIndex + 1}/${totalWindows} completed and flushed to disk.${colors.reset}`);
    }

    // Decrement this chat's pending counter; extract threads when it hits 0
    const remaining = (chatPendingCount.get(chatJid) ?? 1) - 1;
    chatPendingCount.set(chatJid, remaining);
    if (remaining === 0) {
      // Free the chat slot and immediately activate the next waiting chat
      activeChats.delete(chatJid);
      activateNextChats();
      const ctx = chatContextByJid.get(chatJid);
      if (ctx) extractAndSaveThreads(ctx);
    }
  }

  if (allPendingTasks.length > 0) {
    const totalTasks = allPendingTasks.length;
    console.log(`⚡ Dispatching ${colors.yellow}${totalTasks}${colors.reset} pending windows across ${colors.yellow}${chatContexts.length}${colors.reset} chats`);
    console.log(`   concurrency=${MAX_CONCURRENCY} requests | max_chats=${MAX_CONCURRENT_CHATS} | RPM=${RPM_LIMIT}\n`);

    // Seed the dispatch queue with the first batch of chats
    activateNextChats();

    let dispatchIdx = 0;
    let activeRequests = 0;

    await new Promise<void>((resolve) => {
      function processQueue() {
        // Done when all tasks dispatched AND all in-flight requests settled
        if (dispatchIdx >= dispatchQueue.length && activeRequests === 0) {
          resolve();
          return;
        }

        if (
          dispatchIdx < dispatchQueue.length &&
          activeRequests < MAX_CONCURRENCY
        ) {
          const { w, chatJid, totalWindows } = dispatchQueue[dispatchIdx++];
          activeRequests++;

          executeWindowTask(w, chatJid, totalWindows).finally(() => {
            activeRequests--;
            processQueue();
          });
        }

        if (dispatchIdx < dispatchQueue.length || activeRequests > 0) {
          // Poll frequently to check for capacity/slots
          setTimeout(processQueue, 50);
        }
      }

      processQueue();
    });

    console.log(`\n${colors.green}✅ Global annotation pool complete.${colors.reset}\n`);
  } else {
    console.log(`✅ All windows across all chats are already annotated and cached.\n`);
  }
}

const isEntry = process.argv[1] && (
  process.argv[1] === fileURLToPath(import.meta.url) || 
  process.argv[1].endsWith('Annotate_Data.ts')
);

if (isEntry) {
  main().catch((err) => {
    console.error(`\n${colors.red}💥 Fatal execution error detected:${colors.reset}`, err);
    process.exit(1);
  });
}