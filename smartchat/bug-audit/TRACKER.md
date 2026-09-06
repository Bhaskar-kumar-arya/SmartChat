# Bug Audit Tracker

Single source of truth. Read [`README.md`](./README.md) for the session protocol
and the bug-class checklist. Update the status table and append findings here.

Statuses: `TODO` · `IN PROGRESS` · `DONE (<n> findings)` · `BLOCKED`

## Status

| # | Slice | Status | Last touched | Notes |
|---|-------|--------|--------------|-------|
| 1 | WhatsApp worker & socket | DONE (8 findings) | 2026-09-06 | 0 crit / 0 high / 5 med / 3 low |
| 2 | Message pipeline | DONE (12 findings) | 2026-09-06 | 0 crit / 0 high / 6 med / 6 low; peripheral formatters + ffmpeg paths lightly covered |
| 3 | WhatsApp service & subscribers | IN PROGRESS | 2026-09-06 | recent OTP relay + queue-subscriptions fix |
| 4 | Chats & sync | TODO | — | |
| 5 | Contacts | TODO | — | |
| 6 | AI (providers, mentions, citations) | TODO | — | ~45 files; may need 2 sessions |
| 7 | Kernel API modules & router | TODO | — | |
| 8 | Kernel plugins, contributions, permissions | TODO | — | |
| 9 | Kernel storage, channels, ipc, ui | TODO | — | |
| 10 | App IPC & auth | TODO | — | trust boundary |
| 11 | apiServer, search, notification, calls, audio | TODO | — | HTTP surface = apiServer |
| 12 | SDK, tools, data wipe, domain, db, protocol | TODO | — | DataWipeService = data-loss risk |
| 13 | Cross-cutting pass | TODO | — | do only after 1–12 |

## Summary counts

| Severity | Count |
|----------|-------|
| crit | 0 |
| high | 0 |
| med  | 11 |
| low  | 9 |

---

# Findings

## Slice 1 — WhatsApp worker & socket

Files read: whatsapp.worker.ts, routing/workerCommandRouter.ts, socket/{workerConnectionManager,connectSocket,workerConnectionHandler,useLocalPrismaAuthState}.ts, events/{workerEventDispatcher,WorkerEventBusAdapter}.ts, bootstrapWorkerRepositories.ts, utils/workerUtils.ts, services/{WorkerHistorySyncManager,WorkerMediaService,WorkerFavoriteStickerService,WorkerNullChatListEnricher}.ts, services/messages/MediaHelper.ts.

### [S1-01] med — socket/workerConnectionManager.ts:164, 174
**What:** The reconnect paths invoke `this.connect()` as a floating promise — `scheduleReconnect` does `setTimeout(() => this.connect(), delay)` and `wipeAndReconnect` ends with a bare `this.connect()`. Neither awaits or `.catch()`es.
**Why it's a bug:** `connect()` does real async work that can reject: `useLocalPrismaAuthState(prisma)` (Prisma open / query), `repos.authSettingsService.hasCreds()`, `prisma.chat.count()`, `wipeAllData`. Only `fetchLatestBaileysVersion` is guarded. If any of those throw during a reconnect (DB locked, transient Prisma error), the rejection is unhandled and the reconnect chain silently dies — the worker stays permanently disconnected with no retry and no surfaced error, until the app is restarted.
**Fix idea:** wrap the timer/`wipeAndReconnect` body in an async function with try/catch that re-schedules another reconnect on failure.
**Status:** open

### [S1-02] med — socket/workerConnectionManager.ts:188-204 (`wipeAllData`)
**What:** The per-table `DELETE FROM "<table>"` loop runs as a sequence of independent `$executeRawUnsafe` calls with `PRAGMA foreign_keys = OFF` before and `= ON` after, no transaction.
**Why it's a bug:** (1) If any `DELETE` throws mid-loop (FK violation because ordering isn't dependency-aware and the OFF pragma may not stick, disk/lock error), the catch is outside the loop, so the DB is left partially wiped — some tables emptied, others not — an inconsistent state that the subsequent `connect()` treats as a valid DB. (2) `PRAGMA foreign_keys = ON` is skipped on that error path; since the Prisma better-sqlite3 adapter reuses one connection, FK enforcement stays disabled for the rest of the worker's life, letting later writes create orphan rows. (3) `PRAGMA foreign_keys` is a no-op if issued inside an implicit transaction, so the intended disabling may not even take effect.
**Fix idea:** compute delete order or wrap the whole wipe in a single `prisma.$transaction`, and restore `foreign_keys = ON` in a `finally`.
**Status:** open

### [S1-03] med — services/WorkerMediaService.ts:169-190
**What:** For `templateMessage` media, `resolveMediaType` (utils/workerUtils.ts:24-35) returns a **freshly synthesized** `target` object, not a reference into `rawMessage`. `downloadAndCacheMedia` then mutates `mediaMsg.mediaKey` and sets `mediaMsg.localURI`, and persists via `this.messageRepository.updateContentAndFetchWithSender(msgId, JSON.stringify(rawMessage))`.
**Why it's a bug:** for template-wrapped media the mutations never land in `rawMessage`, so the stored `content` never gets `localURI`. Every open of that message re-runs the full download, and the renderer has no `app://media/...` URI to resolve, so template media effectively never displays from cache.
**Fix idea:** write the resolved node back into the real message tree (or persist a normalized copy), instead of mutating the throwaway object.
**Status:** open

### [S1-04] med — services/WorkerMediaService.ts:49-53, 64-92
**What:** `clearFavoriteStickerQueue()` sets `activeDownloadsCount = 0` and `isProcessingQueue = false` unconditionally, but in-flight `downloadAndCacheMedia` promises are not cancelled.
**Why it's a bug:** `WorkerHistorySyncManager.clear()` calls `clearFavoriteStickerQueue()` on every reconnect / new sync. Any download still running when that happens will, on settle, run its `.finally` → `this.activeDownloadsCount--`, driving the counter negative. From then on `activeDownloadsCount >= this.concurrencyLimit` is satisfied only after `limit + N` concurrent downloads, so the concurrency cap is silently raised for the rest of the session (repeatedly, once per leftover). Unbounded parallel media downloads during the next sync.
**Fix idea:** track in-flight promises and either await/settle them in `clear()`, or guard the `.finally` decrement with `Math.max(0, ...)` and a generation token so stale callbacks are ignored.
**Status:** open

### [S1-05] med — services/messages/MediaHelper.ts:83-96 vs services/WorkerFavoriteStickerService.ts:34-41 / utils/workerUtils.ts:84-108
**What:** Two different filename encodings for the same sticker. `getSafeMediaFileName` encodes a Buffer / `{type:'Buffer'}` `fileSha256` as **hex** (`sha.toString('hex')`), producing `hash_<hex>.webp`. `WorkerFavoriteStickerService.getStickerFileName` derives the name from `extractStickerSha`, which encodes the same shapes as **base64**, producing `hash_<base64-sanitized>.webp`.
**Why it's a bug:** `WorkerMediaService` writes the cached sticker file under the hex name. `addStickerToFavorites` computes `srcPath = join(mediaDir, getStickerFileName(...))` (base64 name), finds no file, and throws `Sticker file not downloaded or cached yet` even though the sticker is cached. Manual "add to favorites" fails for any sticker whose stored `fileSha256` isn't already a plain string. (Auto-copy during sync happens to work only because `handleStickerAutoCopy` passes the real `filePath` through directly.)
**Fix idea:** share one canonical sha-encoding + filename helper between `MediaHelper` and the worker sticker service.
**Status:** open

### [S1-06] low — services/WorkerFavoriteStickerService.ts:166-199 (`syncFavoriteSticker`)
**What:** The `favoriteSticker` row is upserted (create branch) even when `downloadSuccess === false`.
**Why it's a bug:** an app-state sync for a favorite whose media can't be downloaded (403/expired CDN, missing socket) still creates a DB favorite pointing at a `fileName` with no file on disk. `getFavoriteStickers` then returns `app://favourites/<fileName>` that 404s in the UI, with no later self-heal unless the exact sticker is re-encountered during a history sync.
**Fix idea:** only persist the favorite when the file exists, or store a `pending` flag and retry.
**Status:** open

### [S1-07] low — utils/workerUtils.ts:66-70 (`ensureBuffer`)
**What:** Any even-length string matching `/^[0-9a-fA-F]+$/` is decoded as hex; everything else as base64.
**Why it's a bug:** a base64 value (e.g. a `mediaKey` round-tripped through JSON) that happens to contain only `[0-9a-f]` characters and has even length is silently decoded with the wrong encoding, yielding a corrupt buffer and a downstream AES-GCM/decryption failure that looks like a "bad key" rather than an encoding bug.
**Fix idea:** carry an explicit encoding tag, or prefer base64 and only fall back to hex when base64 decode is invalid.
**Status:** open

### [S1-08] low — whatsapp.worker.ts:58-63
**What:** `parentPort.on('message', async (msg) => { await commandRouter.handleCommand(...) })` — each inbound command starts an independent async task; there is no queue or serialization.
**Why it's a bug:** correctness depends entirely on the main process awaiting the `init` reply before sending anything else, and never sending two ordering-sensitive commands concurrently. During a reconnect, `connect()` nulls and replaces `this.sock` mid-flight, so a command that captured the socket via `getSocketOrThrow()` can operate on an ended socket, or hit `Socket not initialized` transiently. A command backlog is processed all-at-once rather than in arrival order.
**Fix idea:** serialize command handling through a promise chain / async queue; reject socket-dependent commands cleanly while `connect()` is in progress.
**Status:** open

## Slice 2 — Message pipeline

Files read: MessageService.ts, MessageParser.ts, MessageRepository.ts, MessageQueryRepository.ts,
MessageEnricher.ts, MessageIdentityResolver.ts, MessageActionService.ts, MessageSenderService.ts,
MediaService.ts, MediaHelper.ts, MessageVectorRepository.ts, ReactionRepository.ts,
ReceiptRepository.ts (+ ReceiptService.ts for context), FavoriteStickerService.ts,
StickerMetadataService.ts, processors/{Standard,Reaction,Protocol,Secret}MessageProcessor.ts,
formatters/{MessageFormatterRegistry,index,Conversation,Poll}.ts, tools/ReadMessagesTool.ts (SQL path).
Not fully audited (peripheral / thin): remaining formatters (Image/Video/Sticker/Document/Audio/
Contact/Location/Reaction), StickerMetadataService deep ffmpeg paths.

### [S2-01] med — MessageRepository.ts:59-70 (`upsertMessage` update branch)
**What:** The `update` payload always sets `status: rest.status`. For a `messages.upsert`
re-delivery of an already-stored outbound message, `StandardMessageProcessor` computes
`status = mapBaileysStatus(context.msg.status)` and `mapBaileysStatus(undefined) === 'SENT'`.
**Why it's a bug:** Baileys re-emits `messages.upsert` for the same message on reconnect / notify
vs append. If the message had already progressed to `DELIVERED`/`READ` via `ReceiptService`
(which carefully enforces monotonic transitions with `statusMap`), this upsert clobbers it back
to `SENT` — read / double-tick state regresses in the UI until (if ever) another receipt arrives.
`upsertMessage` bypasses the monotonic guard that every other status writer respects.
**Fix idea:** in the update branch, only lower→higher status transitions, or omit `status` from
`update` entirely and let `ReceiptService` own it; or read existing status and `Math.max` the level.
**Status:** open

### [S2-02] med — MessageSenderService.ts:226-253 (text) & 341-392 (media)
**What:** The optimistic pending row is persisted with `status: 'PENDING'` and emitted to the UI,
then `sock.sendMessage(...)` runs as a background promise whose `.catch` only `console.error`s.
**Why it's a bug:** if the send rejects (offline, rate-limited, bad JID, socket mid-reconnect),
there is no transition to a `FAILED` status, no event to the UI, and no retry/outbox. The message
sits at `PENDING` in the DB and as a spinner in the UI forever; the user believes it is "sending"
when WhatsApp never received it. On next app start nothing re-sends it (no pending-outbox scan in
this service). Silent outbound message loss.
**Fix idea:** on send failure, set status `FAILED` and emit `message:status-updated`; add a
manual-retry path and/or a startup outbox re-send. (Check slice 3 for any existing pending re-send
before fixing.)
**Status:** open

### [S2-03] med — MessageVectorRepository.ts:17-22 (`searchVectorMatch`)
**What:** The `messageId IN (...)` restriction is only applied when
`candidateIds.length > 0 && candidateIds.length < 2000`. At exactly 2000+ candidate IDs the
`filterSql` stays `''` and the query runs an unrestricted global vector MATCH.
**Why it's a bug:** the caller passes `candidateIds` to scope the semantic search (e.g. to a
keyword-prefiltered or permission-limited set). Once that set grows past 2000 the scope is silently
dropped and the search returns matches from *all* chats/messages — wrong results, and a potential
scope/leak issue depending on why the caller restricted it. Failure is silent (no log, no error).
**Fix idea:** for large candidate sets, chunk the `IN` list (or stage IDs into a temp table and
JOIN), never silently drop the filter. If it is purely a perf guard, still enforce it.
**Status:** open

### [S2-04] med — MediaService.ts:154-158 (`clearFavoriteStickerQueue`)
**What:** Sets `activeDownloadsCount = 0` and `isProcessingQueue = false` unconditionally while
in-flight `downloadAndCacheMedia` promises from `processQueue` are still running.
**Why it's a bug:** main-process twin of [S1-04]. Each leftover download's `.finally` runs
`this.activeDownloadsCount--`, driving the counter negative. Thereafter
`activeDownloadsCount >= concurrencyLimit` only trips after `limit + N` concurrent downloads, so
the concurrency cap is silently raised for the rest of the session (once per leftover), causing
unbounded parallel media downloads. Called on sync teardown / pause churn.
**Fix idea:** track in-flight promises and settle them in `clear()`, or guard the decrement with
`Math.max(0, ...)` plus a generation token so stale `.finally` callbacks are ignored.
**Status:** open

### [S2-05] med — ReactionRepository.ts:26-34 (`upsertReaction`) & 124-146 (`bulkSyncReactions`)
**What:** `upsert` overwrites `text` + `timestamp` with whatever was processed last, with no check
that the incoming `timestamp` is newer than the stored row.
**Why it's a bug:** reaction events arrive out of order — history sync can deliver an old reaction
(or an old *removal*) after a newer live one; `bulkSyncReactions` dedups by timestamp *within its
batch* but then still unconditionally upserts over DB rows that may be newer than the batch. Result:
a stale reaction clobbers the current one, or a resurrected reaction reappears after removal (lost
update / timestamp-vs-sequence confusion). `ReceiptService` guards this class of transition;
reactions do not.
**Fix idea:** in `upsert`, add `where`/conditional so `update` only applies when
`incoming.timestamp >= existing.timestamp`; for removals, only delete if the delete event is newer
than the stored reaction.
**Status:** open

### [S2-06] med — MessageActionService.ts:238-243 (`forwardMessage`)
**What:** `for (const destJid of destinations) { await this.forwardToDestination(...) ; results.push(res) }`
— any destination that throws aborts the loop and the whole method rejects; `results` (successful
forwards so far) is discarded.
**Why it's a bug:** forwarding to N chats where chat #k fails (blocked, invalid JID, transient
socket error) surfaces only an error to the caller with no indication that chats 1..k-1 already
received the message. A naive retry re-forwards duplicates to those chats.
**Fix idea:** collect per-destination `{ jid, ok, error }`, never abort the loop on one failure,
and return partial success.
**Status:** open

### [S2-07] low — MediaService.ts:39-55, 292-322 (`resolveMediaType` / `downloadAndCacheMedia`)
**What:** main-process twin of [S1-03]. For `templateMessage` media, `resolveMediaType` synthesizes
a fresh `target` object; `mediaMsg` then points at that throwaway node (not into `rawMessage`).
`downloadAndCacheMedia` sets `mediaMsg.localURI` and persists `JSON.stringify(rawMessage)`.
**Why it's a bug:** for template-wrapped media the `localURI` never lands in `rawMessage`, so the
stored `content` never gains a cache URI. Every open re-runs the full download and the renderer has
no `app://media/...` to resolve.
**Fix idea:** write the resolved node back into the real message tree before persisting.
**Status:** open

### [S2-08] low — MediaService.ts:95-99 & FavoriteStickerService.ts:202-206 (`ensureBuffer`)
**What:** twin of [S1-07]. `if (/^[0-9a-fA-F]+$/.test(val) && val.length % 2 === 0) hex else base64`.
**Why it's a bug:** a base64 `mediaKey` round-tripped through JSON that happens to be all-`[0-9a-f]`
and even length is decoded as hex → corrupt key → AES-GCM failure that looks like a "bad key".
**Fix idea:** carry an explicit encoding tag, or try base64 first and fall back to hex only on
invalid base64.
**Status:** open

### [S2-09] low — FavoriteStickerService.ts:254-262 (`syncFavoriteSticker`)
**What:** twin of [S1-06]. The `favoriteSticker` row is upserted unconditionally even when
`downloadSuccess === false`.
**Why it's a bug:** an app-state sync for a favorite whose media can't be downloaded (expired CDN,
no socket) still creates a DB favorite whose `fileName` has no file on disk; `getFavoriteStickers`
then returns `app://favourites/<fileName>` that 404s, with no self-heal.
**Fix idea:** only persist when the file exists, or store a `pending` flag and retry on next sync.
**Status:** open

### [S2-10] low — MessageRepository.ts:304-322 (`bulkSyncMessages`)
**What:** `insertNewMessages(...)` then `updateExistingMessages(...)` run as two independent
statement groups (each its own `$transaction` at best, and `createMany` is not transactional with
the update pass). No single transaction spans the batch.
**Why it's a bug:** if the insert pass succeeds and the update pass throws (lock, constraint), the
history-sync batch is half-applied — new rows in, existing rows not refreshed — and the caller is
told nothing (both paths swallow errors to `console.error`).
**Fix idea:** wrap the whole batch in one `prisma.$transaction`, or at least propagate failure so
the sync can retry the batch.
**Status:** open

### [S2-11] low — tools/ReadMessagesTool.ts:212-228 (`getMessagesBySql`)
**What:** SQL mode enforces read-only (`validateSqlQuery`) but applies no row cap. JID mode clamps
to `LIMIT_MAX_MESSAGE` (20000); SQL mode does not.
**Why it's a bug:** an LLM-generated `SELECT id FROM Message` (no LIMIT) loads every message ID,
then `findMessagesByIds` hydrates and the formatter renders all of them — large memory spike / slow
tool call / oversized model context on big histories.
**Fix idea:** append/enforce a `LIMIT` (wrap the query as a subquery) or cap `msgIds` length before hydrating.
**Status:** open

### [S2-12] low — MediaService.ts:482-496 (`openFile`) via ipcHandlers `open-file`
**What:** `fileName = decodeURIComponent(localURI.split('/').pop() || '')` — the split on `/` happens
*before* `decodeURIComponent`, so a `localURI` containing `%2f`-encoded separators
(`app://media/..%2f..%2fpath`) survives `.pop()` as one segment, then decodes to `../../path`, and
`join(userData, 'media', '../../path')` escapes the media directory into `shell.openPath`.
**Why it's a bug:** the renderer passes an arbitrary string over the `open-file` IPC channel with no
validation; a compromised/buggy renderer or injected content can open an arbitrary local file in the
OS default handler. Limited blast radius (open only, existsSync-gated) but a real trust-boundary gap.
**Fix idea:** decode first, then `path.basename()`, and verify the resolved path stays within the
media dir before `openPath`.
**Status:** open

## Slice 3 — WhatsApp service & subscribers

_none yet_

## Slice 4 — Chats & sync

_none yet_

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

Once slices are audited, triage findings here (which to fix, in what order).
Not started.
