# Backend Bug Audit — Pass 2 — Tracker

Single source of truth for this audit. Read [`README.md`](./README.md) first
(protocol + full checklist + slice map). Independent of `../bug-audit/` — no
need to read that folder.

Statuses: `TODO` · `IN PROGRESS` · `DONE (<n> findings)` · `BLOCKED`

## Status

| # | Slice | Status | Last touched | Notes |
|---|-------|--------|--------------|-------|
| 1 | WhatsApp worker & socket | DONE (5 findings) | 2026-09-07 | 0 crit, 0 high, 2 med, 3 low |
| 2 | Message pipeline | DONE (8 findings) | 2026-09-07 | 0 crit, 0 high, 3 med, 5 low |
| 3 | WhatsApp service & subscribers | DONE (5 findings) | 2026-09-07 | 0 crit, 0 high, 2 med, 3 low |
| 4 | Chats & sync | DONE (6 findings) | 2026-09-07 | 0 crit, 0 high, 2 med, 4 low |
| 5 | Contacts | IN PROGRESS | 2026-09-07 | |
| 6 | AI (providers, mentions, citations, prompts) | IN PROGRESS | 2026-09-07 | |
| 7 | Kernel API modules & router | IN PROGRESS | 2026-09-07 | |
| 8 | Kernel plugins, contributions, permissions | IN PROGRESS | 2026-09-07 | |
| 9 | Kernel storage, channels, ipc, ui | IN PROGRESS | 2026-09-07 | |
| 10 | App IPC & auth | IN PROGRESS | 2026-09-07 | |
| 11 | apiServer, search, notification, calls, audio | TODO | — | |
| 12 | SDK, tools, data wipe, domain, db, protocol | TODO | — | |
| 13 | Cross-cutting pass | TODO | — | do only after 1–12 |

## Summary counts

| Severity | Count |
|----------|-------|
| crit | 0 |
| high | 0 |
| med  | 6 |
| low  | 10 |

---

# Findings

## Slice 1 — WhatsApp worker & socket

### [P2-S1-01] med — src/main/workers/whatsapp/socket/connectSocket.ts:42-44
**What:** Baileys `getMessage` callback does `JSON.parse(msg.content)` with no Buffer
reviver, so every binary field comes back as a plain `{type:'Buffer',data:[...]}`
object instead of a `Uint8Array`/`Buffer`.
**Why it's a bug:** message rows are persisted with plain `JSON.stringify(rawMessage)`
(MessageParser.ts:217, StandardMessageProcessor.ts:35, MessageRepository.ts:211), so
`content` never contains real buffers. Baileys uses `getMessage` for (a) resending the
original message on an incoming retry-receipt and (b) decrypting poll-vote updates via
`message.messageContextInfo.messageSecret`. With the secret / media keys delivered as
`{type:'Buffer'}` objects, poll-vote decryption fails and retry resends send malformed
content (or throw inside Baileys), so peers that couldn't decrypt a message stay stuck
on "waiting for this message".
**Fix idea:** `JSON.parse(msg.content, BufferJSON.reviver)` (import `BufferJSON` from
`@whiskeysockets/baileys`); its reviver already understands the `{type:'Buffer',data}`
shape produced by plain stringify.
**Status:** open

### [P2-S1-02] med — src/main/workers/whatsapp/socket/workerConnectionHandler.ts:125-126
**What:** On a 440/409 "conflict" close (WhatsApp opened on another desktop), the
handler only logs "Standing down" — no domain event is published and no reconnect is
scheduled.
**Why it's a bug:** the loggedOut branch publishes `wa-logged-out` and the reconnect
branch publishes progress, but the conflict branch emits nothing except the generic
`connection.update`. The worker socket is now permanently dead; the user gets no
"session replaced / reconnect" prompt and silently stops receiving messages until they
manually restart the app.
**Fix idea:** publish a dedicated event (e.g. `wa-session-replaced`) so the renderer can
show a reconnect CTA, and/or schedule a delayed reconnect attempt.
**Status:** open

### [P2-S1-03] low — src/main/workers/whatsapp/socket/workerConnectionHandler.ts:121-124
**What:** Every `connection === 'close'` with `shouldReconnect` schedules a reconnect at
a fixed `RECONNECT_DELAY_DEFAULT_MS`. Exponential backoff in
`WorkerConnectionManager.scheduleReconnect` only kicks in when `connect()` itself
*throws*, not when the socket connects and then closes again.
**Why it's a bug:** a server-side close loop (transient ban, bad app-state) produces a
tight fixed-interval reconnect loop with no backoff and no ceiling on attempts.
**Fix idea:** track consecutive close-without-open events and grow the delay.
**Status:** open

### [P2-S1-04] low — src/main/workers/whatsapp/services/WorkerHistorySyncManager.ts:233-236
**What:** `skipSync` calls `finishSync`, which returns immediately (setting
`pendingFinish = true`) when `activeChunks > 0`. The command router
(workerCommandRouter.ts:165-174) then replies `{ status: 'success' }` unconditionally.
**Why it's a bug:** the user taps "skip sync", the UI is told it succeeded, but
ingestion keeps running until in-flight chunks drain and only then does completion
fire. The reported state and actual state diverge for the duration.
**Fix idea:** have `finishSync`/`skipSync` resolve only once completion actually runs, or
return a "deferred" status the caller surfaces.
**Status:** open

### [P2-S1-05] low — src/main/workers/whatsapp/services/WorkerMediaService.ts:45-52
**What:** `queuePaused` is set true during history sync
(WorkerHistorySyncManager.handleSyncChunk) and only cleared in `finishSync` /
`setFavoriteStickerQueuePaused(false)`. `clear()` (called on every reconnect) resets the
queue and generation but never unpauses.
**Why it's a bug:** if the worker reconnects after a sync that never reached
`finishSync` (crash, forced restart mid-sync), `queuePaused` stays true for the life of
the process and favorite-sticker downloads from live messages silently never run.
**Fix idea:** reset `queuePaused = false` inside `clearFavoriteStickerQueue()` (or in
`WorkerHistorySyncManager.clear()`).
**Status:** open

## Slice 2 — Message pipeline

### [P2-S2-01] med — src/main/services/messages/processors/StandardMessageProcessor.ts:42-46
**What:** Messages are indexed into the semantic-search vector store exactly once,
at first `messages.upsert`, using whatever `textContent` the pipeline produced at
that moment. Ciphertext messages are indexed with the literal placeholder
`"Waiting for this message. This may take a while."` (set in
MessageService.ts:163 / MessageParser.ts:85). Neither `decryptMessageInDb`
(MessageService.ts:222 → MessageRepository.decryptMessage) nor `editMessageInDb` /
MessageActionService.editMessage re-index the message.
**Why it's a bug:** `EmbeddingService.indexAll` (EmbeddingService.ts:131-136)
skips any id already present in `messageVector`, so once the placeholder / stale
text is indexed it is permanent. Result: (a) undecryptable-then-decrypted
messages (secret messages, poll results, delayed retries) are never searchable by
their real content; (b) the vector index is polluted with dozens of identical
"Waiting for this message" placeholder vectors that match unrelated queries;
(c) edited messages keep their pre-edit text in semantic search forever.
**Fix idea:** on decrypt/edit, call `embeddingService.indexMessage` again
(upsertVector already replaces), or delete the stale vector so `indexAll` re-does
it. Skip indexing `ciphertext` / `system` message types entirely.
**Status:** open

### [P2-S2-02] med — src/main/services/messages/MessageQueryRepository.ts:240-257
**What:** `findMessagesFromTimestamp` runs `SELECT id FROM Message WHERE chatJid = ?
AND timestamp >= ? ORDER BY timestamp ASC` with **no LIMIT** on the "target →
newest" half.
**Why it's a bug:** `MessageService.getMessagesAroundId` (MessageService.ts:445-488)
is the "jump to this message" path used when opening a search hit / quoted-message
link. If the target message is old (e.g. a search result from a year ago in an
active group), this loads every message from that point to now, then
`Promise.all`-enriches each one (JSON.parse of `content`, context-info resolution,
reaction grouping). For a busy chat that is tens of thousands of rows in one IPC
call — main-thread stall and a huge payload, where the UI only needs a screenful.
**Fix idea:** cap the forward fetch (e.g. `LIMIT 200`) and page forward from the
renderer, or fetch a window around the timestamp instead of an open range.
**Status:** open

### [P2-S2-03] med — src/main/services/messages/MediaService.ts:492-506
**What:** `openFile(localURI)` derives the on-disk name with
`decodeURIComponent(localURI.split('/').pop() || '')` and then
`join(app.getPath('userData'), 'media', fileName)` + `shell.openPath`. Splitting on
`/` only: a value containing back-slashes (`app://media/..\..\..\Desktop\x.lnk`)
survives as the "file name" and, on Windows, `join` happily walks out of the media
dir.
**Why it's a bug:** `localURI` reaches this method from the renderer over IPC. A
crafted or buggy caller (or a plugin with media-open permission) can get the app
to `shell.openPath` an arbitrary file outside the media cache — e.g. launch an
executable/`.lnk` the attacker dropped elsewhere.
**Fix idea:** `path.basename(fileName)` after decode, reject names containing
separators / `..`, and verify the resolved path stays under the media dir
(`resolved.startsWith(mediaDir + sep)`).
**Status:** open

### [P2-S2-04] low — src/main/services/messages/processors/ReactionMessageProcessor.ts:22-30
**What:** For a `fromMe` reaction that arrives via `messages.upsert`, `reactorId`
starts as `context.senderId` (always `null` for fromMe — MessageService only
resolves `senderId` when `!key.fromMe`) and is only overwritten if
`findMeIdentity()` already returns a row. If the "me" identity has not been
persisted yet, `reactorId` stays `null` and the `targetId && reactorId !== null`
guard drops the reaction silently.
**Why it's a bug:** early in a fresh login (before contacts/identity sync
completes) the user's own reactions are lost and never reconciled. The returned
`ProcessedMessage.senderId` is also left `null` even when a me-identity exists,
because only the local `reactorId` var is updated.
**Fix idea:** fall back to `resolveMeSenderId(sock)` (as
MessageService.resolveReactorIdForReaction does) and set `senderId` on the result.
**Status:** open

### [P2-S2-05] low — src/main/services/messages/MessageService.ts:557-587
**What:** `processReaction` only persists the reaction `if (reactorId)`, but the
`reaction:processed` event is emitted unconditionally right after.
**Why it's a bug:** when the reactor identity can't be resolved, the renderer is
told a reaction happened and renders it, but nothing is stored — it vanishes on
the next chat reload / re-enrich, and reaction counts diverge between sessions.
**Fix idea:** skip the emit (or emit a distinct "unresolved" shape) when no row
was written.
**Status:** open

### [P2-S2-06] low — src/main/services/messages/MediaHelper.ts:74-109 / FavoriteStickerService.ts:39-64
**What:** `getSafeMediaFileName` builds the cache filename from `fileSha256` as
lowercase **hex** for Buffer/`{type:'Buffer'}`/array shapes, but for a **string**
shape it uses the string as-is (base64, only regex-sanitised). `FavoriteStickerService`
and `MediaService.extractStickerSha` independently re-derive the hash in yet other
encodings (base64 for the DB key).
**Why it's a bug:** the encodings only coincidentally agree because persisted
`content` currently always serialises `fileSha256` as `{type:'Buffer',data:[…]}`.
Any path that ever hands this code a base64/hex *string* sha (e.g. content that
went through a Buffer-aware reviver, or a synced stub) produces a different
filename for the same sticker → duplicate downloads and missed favorite auto-copy
/ dedup.
**Fix idea:** normalise every sha to one canonical encoding (hex) in a single
helper and use it everywhere (filename, DB key, lookup).
**Status:** open

### [P2-S2-07] low — src/main/services/messages/MessageQueryRepository.ts:157-159
**What:** `queryMessageIdsBySql` executes caller-supplied SQL via
`$queryRawUnsafe` with no internal enforcement that the statement is read-only,
despite the doc-comment "Executes a read-only query".
**Why it's a bug:** the only current caller (`ReadMessagesTool.getMessagesBySql`)
validates with a SELECT/WITH prefix check + forbidden-keyword regex, so today it's
safe, but the guarantee lives entirely in the caller. Any future caller (another
tool, a plugin-facing endpoint) that trusts the method name gets an unguarded
arbitrary-SQL sink against the message DB.
**Fix idea:** enforce the read-only check inside the repository method too
(reject non-SELECT/WITH, or run under a read-only DB connection).
**Status:** open

### [P2-S2-08] low — src/main/services/messages/StickerMetadataService.ts:25-129
**What:** `processAndAddMetadata` writes `processed_*` and `final_*` webp files
into `<userData>/temp_stickers`. The caller
(MessageSenderService.sendMediaMessageWorkflow) deletes the returned `final_*`
only when the whole send path set `isTempFile`; if `processAndAddMetadata` itself
throws after creating a temp file (e.g. `WebP.Image().load` fails on the ffmpeg
output), nothing cleans it up, and the directory is never swept at startup.
**Why it's a bug:** every failed sticker send leaks a temp file; over time
`temp_stickers` grows unbounded.
**Fix idea:** wrap in try/finally that removes intermediates on any exit, and
sweep the temp dir on app start.
**Status:** open

## Slice 3 — WhatsApp service & subscribers

### [P2-S3-01] med — src/main/services/whatsapp/WhatsAppConnectionManager.ts:126, 145-152
**What:** `connect()` sets `this.isFreshLogin = true` when no creds exist but never
resets it to `false`. Every later `connect()` in the same app session therefore still
sees `isFreshLogin === true`.
**Why it's a bug:** after a fresh QR login, if `connect()` runs again in the same
process — supervised restart via `handleWorkerDeath()` (worker exits non-zero), a
settings toggle, or a manual re-login — the still-true flag makes the code
(a) call `authSettingsService.clearHistorySyncCompleted()` again at line 146, wiping
the just-persisted "history sync done" flag, and (b) compute
`shouldSyncHistory = this.isFreshLogin || !isHistorySyncCompleted` → always `true`, so
the worker is started with `shouldSyncHistory = true` and re-runs a full history sync
(heavy DB ingestion + bandwidth + re-dedup) that already completed. Repeats on every
subsequent reconnect for the life of the process. The worker's own
`workerConnectionManager` has setter plumbing to clear its `isFreshLogin`; the
main-process manager has none.
**Fix idea:** set `this.isFreshLogin = false` once the fresh-login path has been
consumed (after reading `shouldSyncHistory`), or drive it entirely off
`hasCreds()` / `getHistorySyncCompleted()` instead of a sticky field.
**Status:** open

### [P2-S3-02] med — src/main/services/whatsapp/AppStateSyncParser.ts:114-135
**What:** `handleMute` emits `chat:updated` with `update.muteExpiration` set to
`muteSec`, a **bigint** (seconds, or `-1n` for "muted forever"). Every other emitter of
`chat:updated.muteExpiration` produces a plain `number`
(`WAEventHandler.handleChatsUpdate`/`handleChatsUpsert` via
`Math.floor(num / MS_IN_SEC)`), and `handlePin` in this same file emits `pinned` as a
`number`.
**Why it's a bug:** `PersistenceSubscriber.onChatUpdated` forwards the value straight
into `chatService.upsertChat(jid, { muteExpiration: <bigint> })`. Prisma `Int`/`Float`
columns reject a JS `bigint` ("Unable to fit value" / type error), so the write throws,
is swallowed by the subscriber's `.catch`, and the mute/unmute performed on the phone
never lands in the desktop DB. `-1n` as the "indefinite mute" sentinel also disagrees
with the numeric threshold logic used on the read path.
**Fix idea:** emit `Number(muteSec)` (and a plain number sentinel) from `handleMute`,
matching the other `chat:updated` producers.
**Status:** open

### [P2-S3-03] low — src/main/services/whatsapp/subscribers/CallEventSubscriber.ts:31
**What:** `onCall` writes `upsertCallLog({ …, timestamp: BigInt(Math.floor(Date.now()/1000)) })`
for every call event, ignoring `call.date` (which Baileys does populate and which
`WAEventHandler.handleCallEvent` already reads for the synthetic message timestamp).
**Why it's a bug:** (a) call events replayed during offline catch-up after a reconnect
get stamped with "now" instead of when the call happened, mis-ordering the call log;
(b) a single call fires multiple events (`offer` → `ringing` → `terminate`), and
`upsertCallLog` is keyed by `call.id`, so each event overwrites `timestamp` with a
later "now" — a missed call ends up timestamped at its terminate event, not its start.
**Fix idea:** use `call.date?.getTime()` when present, falling back to `Date.now()`, and
don't overwrite an existing timestamp on later status updates for the same id.
**Status:** open

### [P2-S3-04] low — src/main/services/whatsapp/WASocketFactory.ts:39-50
**What:** `WASocketFactory` is constructed in `ServiceContainer.ts:333` and stored, but
`createSocket()` is never called anywhere in production (only in
`WASocketFactory.test.ts`) — the live socket is created by the worker's
`connectSocket.ts`. The class is dead code. Its `getMessage` also does
`JSON.parse(msg.content)` with no `BufferJSON.reviver` (the same defect as P2-S1-01).
**Why it's a bug:** dead code that duplicates a real bug is a trap — a future change
that re-wires the main-process socket through this factory would silently reintroduce
the broken poll-vote / retry-receipt decryption from P2-S1-01. It also keeps
`fetchLatestBaileysVersion` / socket deps referenced from a path that is never
exercised.
**Fix idea:** delete `WASocketFactory` + `IWASocketFactory` + the container wiring, or
if it is meant to be used, fix `getMessage` to parse with `BufferJSON.reviver`.
**Status:** open

### [P2-S3-05] low — src/main/services/whatsapp/WAEventLogger.ts (whole file)
**What:** The `WAEventLogger` module and its `waEventLogger` singleton are never
imported or called anywhere in `src/**` — it is entirely dead code (~220 lines).
**Why it's a bug:** beyond being dead weight, the design as written is a latent
foot-gun: if wired per its own docstring (`sock.ev.process` → `logBatch(events)`) it
writes one JSONL file per calendar day under `logs/` (dev) or `userData/logs` (prod)
with the **full sanitised payload of every Baileys event**, and nothing ever prunes or
size-caps those files — unbounded disk growth for any long-lived install, plus a
synchronous `JSON.stringify` of every event payload on the hot path.
**Fix idea:** delete the module, or if it is wanted for debugging, gate it behind a
debug flag and add day-count / size retention.
**Status:** open

## Slice 4 — Chats & sync

### [P2-S4-01] med — src/main/services/sync/SyncRepository.ts:89-98, 177-186, 203-214, 286-296, 46-64
**What:** Every bulk *update* path wraps per-row `prisma.*.update()` calls in a single
`prisma.$transaction(ops)` — `bulkUpdateChats`, `bulkUpdateIdentities`,
`bulkUpdateIdentityAliases`, `bulkUpsertChatMembers` (update branch),
`bulkUpdateCommunityAnnounces`.
**Why it's a bug:** if any one target row is gone by the time the transaction runs, the
`update` raises P2025 and the whole transaction rolls back — every other update in the
batch is silently lost. This is not hypothetical during group hydration:
`GroupHydrationService.hydrateBatch` runs these across `setImmediate` yield points and its
own catch comment states that concurrent `contacts.upsert` / live group events "interleaving
at a yield point can race a batch's read-then-…/$transaction and raise P2002/P2025". A
concurrent contact-merge deleting one merged `Identity` therefore discards that batch's
entire alias re-point, member role, and phone-number backfill set, not just the stale row.
**Fix idea:** use `updateMany` where possible, or run the ops individually each with its own
`.catch()` so one missing row can't roll back the rest; or re-filter ids against a fresh
existence read immediately before the write.
**Status:** open

### [P2-S4-02] med — src/main/services/chats/sync/ChatSyncHandler.ts:63-66 vs src/main/services/sync/SyncChatsHandler.ts:107-113
**What:** The two history/hydration chat-sync paths normalize `muteExpiration` differently.
`SyncChatsHandler` (chats payload) converts ms→seconds (`muteVal > 10000000000n ? /1000n`)
before storing; `ChatSyncHandler` (group-metadata hydration) stores `raw.muteExpiration`
verbatim with no ms→seconds guard.
**Why it's a bug:** `ChatService.isChatMuted` interprets the stored value as **seconds**
(`expiration * 1000 > Date.now()`). If group metadata ever delivers a millisecond mute
expiration for a group, that group is treated as muted ~1000× further into the future than
intended (effectively muted forever), and the two code paths disagree on the same field.
**Fix idea:** extract the ms→seconds normalization into one shared helper and use it in both
handlers (and in `ChatService.upsertChat`).
**Status:** open

### [P2-S4-03] low — src/main/services/sync/SyncChatsHandler.ts:131, src/main/services/sync/SyncContactsHandler.ts:124
**What:** `processChats` returns `chats.length` and `processContacts` returns
`contacts.length`, not the number of rows actually processed. Both `continue` past entries
with no `.id`; `processContacts` also skips bare-LID contacts.
**Why it's a bug:** `handleHistorySync` logs these and returns them as `chatCount` /
`contactCount`, which `HistorySyncManager` surfaces as sync stats — inflated whenever the
payload carries id-less or bare-LID entries (common in `contacts`).
**Fix idea:** return the local `count` (or a separate processed counter).
**Status:** open

### [P2-S4-04] low — src/main/services/chats/ChatListEnricher.ts:24, 33, src/main/services/sync/SyncMessagesHandler.ts:337-342
**What:** A chat that appears only in the history-sync `messages[]` array (not `chats[]`)
is created via `chatRepository.upsertChat(remoteJid, {})`, leaving `Chat.timestamp = 0n`.
`ChatListEnricher.getChatList` orders and paginates purely on `Chat.timestamp`
(`findChatsPaginated` → `orderBy [{pinned desc},{timestamp desc}]`).
**Why it's a bug:** such chats sort to the very bottom of the chat list and can fall off the
visible page, even though `enrichSingleChat` fetches `findLastMessage` separately and shows a
recent preview + time. Only self-corrects once a live message updates the timestamp.
**Fix idea:** in `SyncMessagesHandler._parseBatch`, upsert the chat with the message
timestamp (max seen) instead of `{}`.
**Status:** open

### [P2-S4-05] low — src/main/services/sync/SyncMessagesHandler.ts:366-388
**What:** `_extractInlineReaction` for a `fromMe` inline `reactionMessage` sets
`reactorId = msg.senderId` and only overrides with `meIdentityId` when that is non-null.
`msg.senderId` is null for `fromMe` rows (`_resolveSenderId` returns null when `fromMe`).
**Why it's a bug:** when the logged-in user's identity id can't be resolved
(`meIdentityId === null`, e.g. very early sync before self-contact exists), the guard
`if (emoji && reactorId)` fails and the user's own history-synced reactions are silently
dropped.
**Fix idea:** resolve/create the self identity before processing, or skip-and-retry these
rows rather than discarding.
**Status:** open

### [P2-S4-06] low — src/main/services/sync/SyncMessagesHandler.ts:96, 99-102; src/main/services/messages/ReactionRepository.ts:94-97
**What:** `importedMessages.push(...(standardMessages as unknown as Message[]))` — the
returned array is typed `Message[]` but holds pre-persistence `SyncMessageRow` objects, and
only `reactionMessage` rows are filtered out, not rows that `bulkSyncMessages` found already
in the DB. Separately, `bulkSyncReactions`'s second param `_currentBatchIds` is entirely
unused (its doc comment still claims batch-id matching), yet `processMessages` builds a fresh
`new Set(messageRows.map(m => m.id))` every batch to pass it.
**Why it's a bug:** `downloadFavoriteStickersFromSync` re-queries and re-queues favorite
sticker downloads for already-synced stickers on every overlapping history chunk; and the
`Message[]` type is a lie (missing real columns/defaults) that will bite any future consumer.
Dead param + stale contract + wasted per-batch Set allocation.
**Fix idea:** return only genuinely-inserted rows (have `bulkSyncMessages` report them), fix
the type, and drop the unused `_currentBatchIds` param + its call-site Set.
**Status:** open

## Slice 5 — Contacts
_none yet_

## Slice 6 — AI
_none yet_

## Slice 7 — Kernel API modules & router
_none yet_

## Slice 8 — Kernel plugins, contributions, permissions
_none yet_

## Slice 9 — Kernel storage, channels, ipc, ui
_none yet_

## Slice 10 — App IPC & auth
_none yet_

## Slice 11 — apiServer, search, notification, calls, audio
_none yet_

## Slice 12 — SDK, tools, data wipe, domain, db, protocol
_none yet_

## Slice 13 — Cross-cutting pass
_none yet_

---

# Fix phase (after audit)

Not started. When it starts: commit directly to `main`, test-first where
feasible, manually verify in the running app for IPC/socket/lifecycle bugs,
record a test/typecheck baseline first. See `FIX_PLAN.md`.
