import { unwrapMessage, getMessageType } from '../src/main/utils/messageUtils';
import { createMessageFormatterRegistry } from '../src/main/services/messages/formatters';
import { proto } from '@whiskeysockets/baileys';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { execSync } from 'child_process';
import { GoogleGenAI } from '@google/genai';

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
const KEY_UNKNOWN_CHAT = 'unknown_chat';
const GROUP_JID_SUFFIX = '@g.us';
const CHAT_TYPE_DM = 'DM';
const CHAT_TYPE_GROUP = 'GROUP';
const FORMAT_TRANSCRIPT = 'transcript';
const LOCALE_EN_US = 'en-US';
const TRUNCATE_LIMIT_REPLY = 35;

// API KEY CONFIGURATION
// You can replace this placeholder with your actual API key,
// or set the GEMINI_API_KEY environment variable.
const GEMINI_API_KEY = "AIzaSyDTfVHNlBOGLdgRSGISCPccYCq9-YLRGd0";

const GROUP_NAME_QUERY = '%Bhaskara%';

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
 * Falls back to textContent, then empty string.
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

  return {
    quotedMsgId,
    participant,
    quotedText
  };
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

function formatMessageForPrompt(
  index: number,
  m: any,
  unwrapped: proto.IMessage | null | undefined,
  nameMap: Map<string, string>,
  isDM: boolean,
  formatterRegistry: any
): string {
  const timeStr = new Date(Number(m.timestamp) * 1000).toLocaleTimeString();
  const senderLabel = getSenderLabel(m, isDM, nameMap);
  const formattedContent = formatMessageContent(m, unwrapped, formatterRegistry);
  const replyContext = getReplyContextString(unwrapped, nameMap, isDM, formatterRegistry);

  return `[${index}] [${timeStr}] ${senderLabel}: ${replyContext}${formattedContent}`;
}

function collectUniqueJids(messages: any[], formatterRegistry: any): Set<string> {
  const uniqueJids = new Set<string>();
  for (const m of messages) {
    if (m.chatJid) uniqueJids.add(m.chatJid);
    if (m.participant) uniqueJids.add(m.participant);

    if (m.content) {
      try {
        const contentObj = typeof m.content === 'string' ? JSON.parse(m.content) : m.content;
        const unwrapped = unwrapMessage(contentObj);
        const quoted = getQuotedMessageContext(unwrapped, formatterRegistry);
        if (quoted && quoted.participant) {
          uniqueJids.add(quoted.participant);
        }
      } catch (e: unknown) {
        // ignore
      }
    }
  }
  return uniqueJids;
}

function buildChatInfoMap(
  uniqueJids: Set<string>,
  nameMap: Map<string, string>,
  dbPath: string
): Map<string, { name: string; type: string }> {
  const chatInfoMap = new Map<string, { name: string; type: string }>();
  if (uniqueJids.size > 0) {
    const jidsArray = Array.from(uniqueJids).map(j => `'${j.replace(/'/g, "''")}'`).join(',');
    const chatsRows = runSql(dbPath, `SELECT jid, name, type FROM Chat WHERE jid IN (${jidsArray});`);
    for (const row of chatsRows) {
      let name = row.name || '';
      if (row.type === CHAT_TYPE_DM) {
        name = nameMap.get(row.jid) || row.jid.split('@')[0];
      } else {
        name = row.name || row.jid.split('@')[0];
      }
      chatInfoMap.set(row.jid, { name, type: row.type });
    }
  }
  return chatInfoMap;
}

function chunkMessagesIntoWindows(
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

    if (j >= messages.length) {
      break;
    }
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

/**
 * Returns up to `contextSize` messages ending at globalIdx (inclusive),
 * drawn from the GLOBAL message array — not the window-local slice.
 */
function getContextMessages(
  allMessages: any[],
  globalIdx: number,
  contextSize = 5
): any[] {
  const start = Math.max(0, globalIdx - (contextSize - 1));
  return allMessages.slice(start, globalIdx + 1);
}

// After all windows are processed, rebuild cross-window pairs properly
/**
 * Post-processing pass that rebuilds ALL training pairs using global context.
 *
 * Fixes two bugs in the per-window extraction:
 *   1. context_i now always spans the global message array, so context
 *      correctly crosses window boundaries.
 *   2. Hard negatives are sampled from DIFFERENT threads only, preventing
 *      same-thread ancestors (grandparents, great-grandparents) from being
 *      labelled as negatives and producing contradictory training signal.
 *
 * Deduplication: when the same (globalI, globalJ) positive pair appears in
 * two overlapping windows, only the first occurrence is kept (the one where
 * globalI has the longest history behind it).
 *
 * Negative count: capped at 3 per msg_j total (not per positive parent),
 * keeping the per-message ratio stable regardless of how many parents a
 * message has.
 */
function rebuildTrainingPairsWithGlobalContext(
  allMessages: any[],
  annotationsPath: string,
  nameMap: Map<string, string>,
  isDM: boolean,
  formatterRegistry: any,
  seedThreadMap: Map<number, number>,   // <-- NEW PARAM (pass result of buildSeedThreadsFromQuoteReplies)
  contextSize = 5,
  maxNegsPerMessage = 3,
  candidateWindow = 20
): any[] {
  // ── 1. Load all annotations ───────────────────────────────────────────────
  const annotations: Map<number, any> = new Map();
  const lines = fs
    .readFileSync(annotationsPath, "utf8")
    .split("\n")
    .filter((l) => l.trim());

  for (const line of lines) {
    try {
      const obj = JSON.parse(line);
      if (typeof obj.windowIndex === "number") {
        annotations.set(obj.windowIndex, obj);
      }
    } catch {
      // skip malformed lines
    }
  }

  // ── 2. Pre-build global index lookup ──────────────────────────────────────
  const globalIndexMap = new Map<any, number>(
    allMessages.map((m, i) => [m, i])
  );

  const toMsgRecord = (msg: any) => ({
    text: getFormattedText(msg, formatterRegistry),
    sender: getSenderLabel(msg, isDM, nameMap),
    timestamp: msg.timestamp,
    globalIndex: globalIndexMap.get(msg) ?? -1,
  });

  // ── 3. Dedup sets ─────────────────────────────────────────────────────────
  const seenPositives = new Set<string>();   // "globalI_globalJ"
  const seenNegatives = new Set<string>();   // "neg_globalI_globalJ"

  const pairs: any[] = [];

  // ── 4. Helper: emit one positive pair (deduped) ───────────────────────────
  const emitPositive = (
    globalI: number,
    globalJ: number,
    windowIdx: number,
    label: number       // 1.0 for direct, 0.7 for multi-hop
  ) => {
    const key = `${globalI}_${globalJ}`;
    if (seenPositives.has(key)) return;
    seenPositives.add(key);
    const ctxMsgs = getContextMessages(allMessages, globalI, contextSize);
    pairs.push({
      context_i: ctxMsgs.map(toMsgRecord),
      msg_j: toMsgRecord(allMessages[globalJ]),
      label,
      windowIndex: windowIdx,
      globalI,
      globalJ,
    });
  };

  // ── 5. Helper: emit one hard negative pair (deduped) ─────────────────────
  const emitNegative = (
    globalNegI: number,
    globalJ: number,
    windowIdx: number
  ) => {
    const key = `neg_${globalNegI}_${globalJ}`;
    if (seenNegatives.has(key)) return;
    seenNegatives.add(key);
    const ctxMsgs = getContextMessages(allMessages, globalNegI, contextSize);
    pairs.push({
      context_i: ctxMsgs.map(toMsgRecord),
      msg_j: toMsgRecord(allMessages[globalJ]),
      label: 0,
      windowIndex: windowIdx,
      globalI: globalNegI,
      globalJ,
    });
  };

  // ── 6. TIER 1: seed pairs from native quote-replies ───────────────────────
  // These are the highest-quality positives — zero annotation cost.
  // Emit direct link (label=1). Multi-hop within seed threads is handled
  // in step 7 below alongside LLM-annotated threads.
  for (const [globalJ, threadRoot] of seedThreadMap) {
    // find the direct parent via seedEdges is implicit: we only need the
    // thread membership here. Direct edges were already stored in seedEdges
    // and are re-emitted in the annotation loop or via step 7. To avoid
    // duplication we just register them in seenPositives now — actual
    // pair objects are built in the unified thread pass below.
    void threadRoot; // suppress unused-var warning; used in step 7
  }

  // Collect seed direct edges so we can emit them cleanly in the unified pass
  // We rebuild them from seedThreadMap parent structure via the find function.
  // Simpler: re-parse quote-reply edges from the messages directly (O(N)).
  const directSeedEdges = new Map<number, number[]>(); // globalJ → [globalI, ...]
  for (let j = 0; j < allMessages.length; j++) {
    const m = allMessages[j];
    let contentObj: Record<string, unknown> | null = null;
    try {
      contentObj =
        typeof m.content === "string" ? JSON.parse(m.content) : m.content;
    } catch {
      // ignore
    }
    const unwrapped = unwrapMessage(contentObj);
    const quoted = getQuotedMessageContext(unwrapped, formatterRegistry);
    if (!quoted?.quotedMsgId) continue;

    // Find the global index of the quoted message by ID
    const parentIdx = allMessages.findIndex((msg) => msg.id === quoted.quotedMsgId);
    if (parentIdx < 0 || parentIdx >= j) continue;

    const existing = directSeedEdges.get(j) ?? [];
    existing.push(parentIdx);
    directSeedEdges.set(j, existing);
  }

  // ── 7. Unified thread pass: LLM annotations + seed threads ───────────────
  //
  // For every annotation window we:
  //   a) build the window-local thread map (same as before)
  //   b) merge it with seedThreadMap so concurrent-thread detection is global
  //   c) emit direct-link positives  (label=1.0)
  //   d) emit multi-hop positives    (label=0.7)  ← NEW
  //   e) emit concurrent-thread hard negatives    ← UPGRADED

  for (const [windowIdx, ann] of annotations) {
    const startIndex: number = ann.startIndex;
    const links: any[] = ann.annotation.links;

    // Build window-local thread membership (Union-Find, global indices)
    const localThreadMap = buildThreadMap(links, startIndex);

    // Merge with seed thread map: if a node appears in both, union their roots.
    // We do this by building a combined find function that delegates to both.
    // Simple approach: clone localThreadMap and overlay seed memberships.
    const mergedThreadOf = (gi: number): number => {
      // Prefer local annotation thread ID; fall back to seed thread ID
      if (localThreadMap.has(gi)) return localThreadMap.get(gi)!;
      if (seedThreadMap.has(gi)) return seedThreadMap.get(gi)!;
      return gi; // singleton — its own thread
    };

    // Collect all global indices active in this window
    const windowGlobalIndices = links.map((l) => startIndex + l.msg);

    // Group window messages by their merged thread ID
    const threadToMembers = new Map<number, number[]>();
    for (const gi of windowGlobalIndices) {
      const tid = mergedThreadOf(gi);
      const members = threadToMembers.get(tid) ?? [];
      members.push(gi);
      threadToMembers.set(tid, members);
    }

    // Track neg quota per globalJ across all its parents
    const negCountPerJ = new Map<number, number>();

    for (const link of links) {
      const globalJ = startIndex + link.msg;
      const directParents: number[] = Array.isArray(link.replies_to)
        ? link.replies_to.map((p: number) => startIndex + p)
        : [];

      // Also include any seed-level direct parents not in LLM annotation
      const seedParents = directSeedEdges.get(globalJ) ?? [];
      const allDirectParents = Array.from(
        new Set([...directParents, ...seedParents])
      );

      const threadIdOfJ = mergedThreadOf(globalJ);
      const sameThreadMembers = (threadToMembers.get(threadIdOfJ) ?? []).filter(
        (gi) => gi < globalJ  // only predecessors
      );

      // ── a) Direct positive pairs (label = 1.0) ────────────────────────────
      for (const globalI of allDirectParents) {
        emitPositive(globalI, globalJ, windowIdx, 1.0);
      }

      // ── b) Multi-hop positive pairs (label = 0.7) ─────────────────────────
      // Same-thread predecessors that are NOT direct parents.
      // These are ancestors, siblings-of-ancestors, etc.
      // Label smoothing (0.7) signals: "related, but not the direct reply".
      const directParentSet = new Set(allDirectParents);
      for (const globalI of sameThreadMembers) {
        if (directParentSet.has(globalI)) continue; // already emitted above
        emitPositive(globalI, globalJ, windowIdx, 0.7);
      }

      // ── c) Concurrent-thread hard negatives ───────────────────────────────
      // Candidate pool: last `candidateWindow` messages before j,
      // excluding:
      //   • any message in the SAME thread as j (direct parent, ancestor,
      //     or seed-thread co-member) — these would be contradictory labels
      //   • j itself
      //
      // Sorted newest-first so the hardest negatives (most temporally
      // proximate, yet from a different thread) are sampled first.
      const sameThreadSet = new Set<number>(sameThreadMembers);
      for (const p of allDirectParents) sameThreadSet.add(p);

      const candidateStart = Math.max(0, globalJ - candidateWindow);
      const negCandidates = Array.from(
        { length: globalJ - candidateStart },
        (_, k) => candidateStart + k
      )
        .filter((gi) => {
          if (sameThreadSet.has(gi)) return false;
          // Also exclude if seed thread says they are co-members
          if (
            seedThreadMap.has(gi) &&
            seedThreadMap.has(globalJ) &&
            seedThreadMap.get(gi) === seedThreadMap.get(globalJ)
          )
            return false;
          return true;
        })
        .sort((a, b) => b - a); // newest-first = hardest

      const alreadyEmitted = negCountPerJ.get(globalJ) ?? 0;
      const quota = maxNegsPerMessage - alreadyEmitted;
      if (quota <= 0) continue;

      let emitted = 0;
      for (const globalNegI of negCandidates) {
        if (emitted >= quota) break;
        emitNegative(globalNegI, globalJ, windowIdx);
        emitted++;
      }
      negCountPerJ.set(globalJ, alreadyEmitted + emitted);
    }
  }

  // ── 8. Emit any seed direct pairs that fell outside all annotation windows ─
  // (e.g. quote-replies near the start of the chat before the first window)
  for (const [globalJ, parents] of directSeedEdges) {
    for (const globalI of parents) {
      emitPositive(globalI, globalJ, -1 /* no window */, 1.0);
    }
    // Hard negatives for these orphan pairs: sample from candidateWindow
    // using only seed thread membership for exclusion.
    const alreadyEmitted = pairs.filter(
      (p) => p.globalJ === globalJ && p.label === 0
    ).length;
    const quota = maxNegsPerMessage - alreadyEmitted;
    if (quota <= 0) continue;

    const threadIdOfJ = seedThreadMap.get(globalJ) ?? globalJ;
    const candidateStart = Math.max(0, globalJ - candidateWindow);
    const negCandidates = Array.from(
      { length: globalJ - candidateStart },
      (_, k) => candidateStart + k
    )
      .filter((gi) => {
        const tid = seedThreadMap.get(gi) ?? gi;
        return tid !== threadIdOfJ;
      })
      .sort((a, b) => b - a);

    let emitted = 0;
    for (const globalNegI of negCandidates) {
      if (emitted >= quota) break;
      emitNegative(globalNegI, globalJ, -1);
      emitted++;
    }
  }

  return pairs;
}


/**
 * Builds a thread membership map using Union-Find over global indices.
 * Messages in the same weakly-connected component share a thread root (threadId).
 *
 * @param links      - The annotation links array (window-relative indices)
 * @param startIndex - The global offset of this window (ann.startIndex)
 * @returns Map<globalIndex, threadRootGlobalIndex>
 */
function buildThreadMap(
  links: any[],
  startIndex: number
): Map<number, number> {
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

  // Initialize all nodes
  for (const link of links) {
    find(startIndex + link.msg);
  }

  // Union each message with its annotated parents
  for (const link of links) {
    const globalJ = startIndex + link.msg;
    if (Array.isArray(link.replies_to)) {
      for (const relParent of link.replies_to) {
        union(startIndex + relParent, globalJ);
      }
    }
  }

  // Resolve final thread IDs (canonical root per component)
  const threadMap = new Map<number, number>();
  for (const link of links) {
    const globalJ = startIndex + link.msg;
    threadMap.set(globalJ, find(globalJ));
  }
  return threadMap;
}

function buildSeedThreadsFromQuoteReplies(
  allMessages: any[],
  nameMap: Map<string, string>,
  isDM: boolean,
  formatterRegistry: any
): {
  seedEdges: Array<{ globalI: number; globalJ: number }>;
  seedThreadMap: Map<number, number>;
} {
  // Build a lookup from WhatsApp message ID (string) → global array index
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
      contentObj =
        typeof m.content === "string" ? JSON.parse(m.content) : m.content;
    } catch {
      // ignore
    }
    const unwrapped = unwrapMessage(contentObj);
    const quoted = getQuotedMessageContext(unwrapped, formatterRegistry);
    if (!quoted || !quoted.quotedMsgId) continue;

    const globalI = msgIdToIndex.get(quoted.quotedMsgId);
    // Only keep forward-pointing edges that exist in the array
    if (globalI === undefined || globalI >= j) continue;

    seedEdges.push({ globalI, globalJ: j });
  }

  // Union-Find over global indices to build seed thread components
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

  for (const { globalI, globalJ } of seedEdges) {
    union(globalI, globalJ);
  }

  // Resolve canonical root for every node that appeared in at least one edge
  const seedThreadMap = new Map<number, number>();
  for (const { globalI, globalJ } of seedEdges) {
    seedThreadMap.set(globalI, find(globalI));
    seedThreadMap.set(globalJ, find(globalJ));
  }

  return { seedEdges, seedThreadMap };
}


async function main() {
  const dbPath = path.resolve(process.cwd(), 'prisma/dev.db');
  const formatterRegistry = createMessageFormatterRegistry();
  const __dirname = path.dirname(fileURLToPath(import.meta.url));

  console.log(`\n${colors.border}╔══════════════════════════════════════════════════════════════╗${colors.reset}`);
  console.log(`  ${colors.cyan}${colors.bright}🤖 SmartChat LLM Training Data Generator${colors.reset}`);
  console.log(`${colors.border}╚══════════════════════════════════════════════════════════════╝${colors.reset}\n`);

  // Setup API Client
  const finalApiKey = process.env.GEMINI_API_KEY || GEMINI_API_KEY;
  if (!finalApiKey) {
    console.error(`${colors.red}❌ Error: Gemini API key is missing.${colors.reset}`);
    console.error(`Please set the ${colors.yellow}GEMINI_API_KEY${colors.reset} environment variable, or hardcode it in:`);
    console.error(`  ${colors.dim}${fileURLToPath(import.meta.url)}${colors.reset}\n`);
    process.exit(1);
  }

  const ai = new GoogleGenAI({ apiKey: finalApiKey });

  console.log(`🔍 Searching for group chat matching: "${colors.yellow}${GROUP_NAME_QUERY}${colors.reset}"`);
  const queryResult = runSql(
    dbPath,
    `SELECT jid, name FROM Chat WHERE name LIKE '${GROUP_NAME_QUERY}' 
     UNION 
     SELECT ia.jid, COALESCE(i.displayName, i.pushName, i.verifiedName) as name 
     FROM IdentityAlias ia 
     JOIN Identity i ON ia.identityId = i.id 
     WHERE i.displayName LIKE '${GROUP_NAME_QUERY}' OR i.pushName LIKE '${GROUP_NAME_QUERY}' OR i.verifiedName LIKE '${GROUP_NAME_QUERY}'
     LIMIT 1;`
  );

  if (queryResult.length === 0) {
    console.error(`\n${colors.red}❌ No chat matching "${GROUP_NAME_QUERY}" found in database.${colors.reset}\n`);
    return;
  }

  const chat = queryResult[0];
  console.log(`\n${colors.green}✅ Found Target Chat:${colors.reset}`);
  console.log(`  - Name: ${colors.bright}${chat.name}${colors.reset}`);
  console.log(`  - JID : ${colors.dim}${chat.jid}${colors.reset}\n`);

  console.log(`📨 Fetching all messages for ${colors.bright}${chat.name}${colors.reset}...`);
  const rawMessages = runSql(
    dbPath,
    `SELECT id, chatJid, senderId, participant, fromMe, timestamp, messageType, content, textContent, isDeleted, isEdited, status 
     FROM Message WHERE chatJid = '${chat.jid}' ORDER BY timestamp ASC;`
  );

  let messages = rawMessages.map((m: any) => ({
    ...m,
    fromMe: m.fromMe === 1,
    isDeleted: m.isDeleted === 1,
    isEdited: m.isEdited === 1,
    timestamp: Number(m.timestamp)
  }));
  messages = messages.slice(0, 150)
  console.log(`📊 Total messages: ${colors.yellow}${messages.length}${colors.reset}`);
  if (messages.length === 0) {
    console.log(`\n${colors.yellow}⚠️ No messages found in this chat.${colors.reset}\n`);
    return;
  }

  console.log(`👥 Resolving sender names...`);
  const uniqueJids = collectUniqueJids(messages, formatterRegistry);
  const nameMap = new Map<string, string>();

  const meAliases = runSql(dbPath, `SELECT jid FROM IdentityAlias WHERE identityId IN (SELECT id FROM Identity WHERE isMe = 1);`);
  for (const row of meAliases) {
    nameMap.set(row.jid, KEYWORD_ME);
  }

  if (uniqueJids.size > 0) {
    const jidsArray = Array.from(uniqueJids).map(j => `'${j.replace(/'/g, "''")}'`).join(',');
    const aliasesRows = runSql(dbPath, `
      SELECT ia.jid, i.isMe, i.displayName, i.pushName, i.verifiedName 
      FROM IdentityAlias ia 
      LEFT JOIN Identity i ON ia.identityId = i.id 
      WHERE ia.jid IN (${jidsArray});
    `);
    for (const row of aliasesRows) {
      if (row.isMe === 1) {
        nameMap.set(row.jid, KEYWORD_ME);
      } else if (!nameMap.has(row.jid)) {
        const name = row.displayName || row.pushName || row.verifiedName || row.jid.split('@')[0];
        nameMap.set(row.jid, name);
      }
    }
  }

  const chatInfoMap = buildChatInfoMap(uniqueJids, nameMap, dbPath);
  const isDM = chat.jid.endsWith(GROUP_JID_SUFFIX) ? false : true;

  console.log(`📦 Segmenting conversation into ~8k token windows...`);
  const windows = chunkMessagesIntoWindows(messages, nameMap, isDM, formatterRegistry, 2000, 20);
  console.log(`🧩 Total generated windows: ${colors.yellow}${windows.length}${colors.reset}\n`);

  // Paths for saving output
  const annotationsPath = path.resolve(__dirname, 'annotations.jsonl');
  const trainPairsPath = path.resolve(__dirname, 'train_pairs.jsonl');

  // Resume capability: Load completed windows
  const completedWindows = new Set<number>();
  if (fs.existsSync(annotationsPath)) {
    const lines = fs.readFileSync(annotationsPath, 'utf8').split('\n');
    for (const line of lines) {
      if (line.trim()) {
        try {
          const obj = JSON.parse(line);
          if (typeof obj.windowIndex === 'number') {
            completedWindows.add(obj.windowIndex);
          }
        } catch (e) {
          // skip
        }
      }
    }
  }

  if (completedWindows.size > 0) {
    console.log(`🔄 Resuming job. Already annotated windows count: ${colors.green}${completedWindows.size}${colors.reset}\n`);
  }

  const systemPrompt = `You are an expert dialogue thread analysis model specializing in chat disentanglement for WhatsApp.
Your task is to analyze an interleaved, chronological chat window and map out directed reply-to links between messages.

### Input Format
You will receive a sequence of messages formatted as:
[index] [timestamp] SenderName: (Optional Explicit Reply Context) message_content

### Output Schema Rules
You must return a valid JSON object matching this exact structure:
{
  "links": [
    {
      "msg": 0,
      "reasoning": "Brief explanation of target or thread context",
      "replies_to": null
    }
  ]
}

### Essential Labeling Rules
1. "msg": Integer index matching the message position exactly (from 0 to N-1).
2. "reasoning": A brief phrase tracking the target context BEFORE selecting the index. You must explicitly look for matching text if a quote block exists.
3. "replies_to": An array of integer indices this message directly responds to.
4. "null" Policy: Set to null if the message initiates a brand-new conversational thread, a completely unrelated topic, or has no valid context parent within the current window view.
5. Chronological Constraint: Any index in "replies_to" MUST be strictly lower than the current "msg" index. No future links.
6. Every single message from index 0 to N-1 must have an entry in the "links" array. Do not truncate early or omit any trailing items.

---

### FEW-SHOT GOLD STANDARD REFERENCE EXAMPLE

#### Example Input Chat Window:
[0] [11:15:00 AM] Rohit: did anyone get the solution for question 3?
[1] [11:15:30 AM] Sneha: (Reply to Rohit: "did anyone get the solution for q...") i solved it, it uses a modified binary search
[2] [11:15:45 AM] Akash: [Photo] what do you guys think of this jacket?
[3] [11:16:02 AM] Sneha: looks clean bro, price?
[4] [11:16:15 AM] Rohit: (Reply to Sneha: "i solved it, it uses a modified b...") can you share the proof snippet?
[5] [11:16:30 AM] Akash: (Reply to Sneha: "looks clean bro, price?") 3k on sale off Myntra
[6] [11:16:45 AM] Kabir: @Akash skip it, looks mid tbh
[7] [11:17:10 AM] Sneha: @Rohit wait, opening laptop
[8] [11:17:40 AM] Kabir: (Message deleted)
[9] [11:18:00 AM] Akash: [Sticker] bad choice anyway

#### Example Expected JSON Output:
{
  "links": [
    {
      "msg": 0,
      "reasoning": "Starts the data structures assignment thread.",
      "replies_to": null
    },
    {
      "msg": 1,
      "reasoning": "Explicit quote-reply directly responding to Rohit's question 3 post at index [0].",
      "replies_to": [0]
    },
    {
      "msg": 2,
      "reasoning": "Breaks context completely to introduce a retail item. New thread.",
      "replies_to": null
    },
    {
      "msg": 3,
      "reasoning": "Implicit context reply responding to Akash's jacket photo at index [2].",
      "replies_to": [2]
    },
    {
      "msg": 4,
      "reasoning": "Explicit quote-reply tracking directly back to Sneha's assignment statement at index [1].",
      "replies_to": [1]
    },
    {
      "msg": 5,
      "reasoning": "Explicit quote-reply answering Sneha's pricing question at index [3].",
      "replies_to": [3]
    },
    {
      "msg": 6,
      "reasoning": "Implicit tag reply criticizing the jacket picture posted by Akash at index [2].",
      "replies_to": [2]
    },
    {
      "msg": 7,
      "reasoning": "Implicit sequential reply continuing her task dialogue with Rohit at index [4].",
      "replies_to": [4]
    },
    {
      "msg": 8,
      "reasoning": "Deleted message placeholder with no text value or context connections.",
      "replies_to": null
    },
    {
      "msg": 9,
      "reasoning": "Implicit reactions sticker wrapping up the jacket commentary chain targeting index [6].",
      "replies_to": [6]
    }
  ]
}
---

Analyze the following chat window data and generate the output cleanly following the rules above. Only return raw JSON content without generic introductory text or markdown formatting wrap outside the application/json framework requirements.`;

  // ── ANNOTATION LOOP ───────────────────────────────────────────────────────
  for (let idx = 0; idx < windows.length; idx++) {
    const w = windows[idx];
    if (completedWindows.has(w.windowIndex)) {
      continue;
    }

    console.log(`[Window ${w.windowIndex + 1}/${windows.length}] Processing window index ${w.windowIndex}`);
    console.log(`  - Messages: ${w.messages.length} (${w.startIndex} to ${w.endIndex})`);
    console.log(`  - Estimated tokens: ${w.estimatedTokens}`);

    const userPrompt = `Analyze the following chat window and output the JSON links structure:

  ${w.formattedText}

  JSON Output:`;

    let success = false;
    let retries = 3;
    let rawResponse = "";
    let parsedAnnotation: any = null;

    fs.writeFile(path.resolve(__dirname, 'prompt.txt'), userPrompt, (err) => {
      if (err) console.log(err);
    });

    while (!success && retries > 0) {
      try {
        console.log(`  - Calling Gemma 4 31B...`);
        const response = await ai.models.generateContent({
          model: 'gemma-4-31b-it',
          contents: userPrompt,
          config: {
            systemInstruction: systemPrompt,
            responseMimeType: 'application/json'
          }
        });

        rawResponse = response.text || '';
        fs.writeFile(path.resolve(__dirname, 'rawOutput.txt'), rawResponse, (err) => {
          if (err) console.log(err);
        });

        parsedAnnotation = JSON.parse(rawResponse.trim());

        const errors = validateAnnotation(parsedAnnotation, w.messages.length);
        if (errors.length > 0) {
          console.warn(`  - ${colors.yellow}Warning: Structural validation failed: ${errors.join(', ')}${colors.reset}`);
          retries--;
          continue;
        }

        success = true;
      } catch (err: any) {
        console.error(`  - ${colors.red}Error calling LLM/parsing JSON: ${err.message || err}${colors.reset}`);
        retries--;
        if (retries > 0) {
          console.log(`  - Retrying in 2 seconds...`);
          await new Promise(res => setTimeout(res, 2000));
        }
      }
    }

    if (!success) {
      console.error(`\n${colors.red}❌ Failed to process window index ${w.windowIndex} after multiple attempts. Skipping.${colors.reset}\n`);
      continue;
    }

    console.log(`  - ${colors.green}Success! Saving annotation...${colors.reset}`);

    // Save raw annotation only — pair extraction happens in the post-processing pass
    const annotationLog = {
      windowIndex: w.windowIndex,
      startIndex: w.startIndex,
      endIndex: w.endIndex,
      estimatedTokens: w.estimatedTokens,
      annotation: parsedAnnotation
    };
    fs.appendFileSync(annotationsPath, JSON.stringify(annotationLog) + '\n', 'utf8');
  }

  // ── POST-PROCESSING: global pair extraction ───────────────────────────────
  console.log(`\n🔍 Mining native quote-reply pairs to build seed threads...`);
  const { seedEdges, seedThreadMap } = buildSeedThreadsFromQuoteReplies(
    messages,
    nameMap,
    isDM,
    formatterRegistry
  );
  console.log(`  - Seed edges found: ${colors.yellow}${seedEdges.length}${colors.reset}`);
  console.log(`  - Unique seed thread members: ${colors.yellow}${seedThreadMap.size}${colors.reset}\n`);

  console.log(`🔗 Rebuilding training pairs with global context, multi-hop positives & concurrent-thread negatives...`);
  const globalPairs = rebuildTrainingPairsWithGlobalContext(
    messages,
    annotationsPath,
    nameMap,
    isDM,
    formatterRegistry,
    seedThreadMap,   // <-- NEW: pass seed threads in
    5,               // contextSize
    3,               // maxNegsPerMessage
    20               // candidateWindow
  );
  // Overwrite train_pairs.jsonl with the clean global version
  fs.writeFileSync(trainPairsPath, '', 'utf8');
  for (const pair of globalPairs) {
    fs.appendFileSync(trainPairsPath, JSON.stringify(pair) + '\n', 'utf8');
  }

  const positiveCount = globalPairs.filter(p => p.label === 1).length;
  const negativeCount = globalPairs.filter(p => p.label === 0).length;

  console.log(`\n${colors.green}🚀 Data annotation and training pair extraction complete!${colors.reset}\n`);
  console.log(`📊 Pairs written: ${colors.yellow}${globalPairs.length}${colors.reset}  (${colors.green}${positiveCount} positives${colors.reset} / ${colors.red}${negativeCount} negatives${colors.reset})`);
  console.log(`📁 Raw Annotations : ${colors.cyan}${annotationsPath}${colors.reset}`);
  console.log(`📁 Training Pairs  : ${colors.cyan}${trainPairsPath}${colors.reset}\n`);
}

main().catch((err) => {
  console.error(`\n${colors.red}💥 Fatal error running the annotation pipeline:${colors.reset}`, err);
  process.exit(1);
});
