# Bug Audit Tracker

Single source of truth. Read [`README.md`](./README.md) for the session protocol
and the bug-class checklist. Update the status table and append findings here.

Statuses: `TODO` · `IN PROGRESS` · `DONE (<n> findings)` · `BLOCKED`

## Status

| # | Slice | Status | Last touched | Notes |
|---|-------|--------|--------------|-------|
| 1 | WhatsApp worker & socket | DONE (8 findings) | 2026-09-06 | 0 crit / 0 high / 5 med / 3 low |
| 2 | Message pipeline | DONE (12 findings) | 2026-09-06 | 0 crit / 0 high / 6 med / 6 low; peripheral formatters + ffmpeg paths lightly covered |
| 3 | WhatsApp service & subscribers | DONE (6 findings) | 2026-09-06 | 1 high / 3 med / 2 low; S3-01 = plugin subs lost on bus rebuild. type files + BaileysPatcher lightly covered |
| 4 | Chats & sync | DONE (9 findings) | 2026-09-06 | 0 crit / 0 high / 4 med / 5 low; S4-01 = group hydration aborts remaining batches on concurrent-write conflict; S4-02 = chat-list pagination returns dup/overflow rows. I*.ts interfaces lightly covered |
| 5 | Contacts | DONE (5 findings) | 2026-09-06 | 0 crit / 0 high / 2 med / 3 low; identity merge tx gap + cross-process cache staleness. I*.ts interfaces lightly covered |
| 6 | AI (providers, mentions, citations) | DONE (11 findings) | 2026-09-06 | 1 crit / 0 high / 7 med / 3 low. Deep-read AIService, providers/*, AIKeyService, FSKeyStorage, AIChatSessionService, AIChatExportService, AIToolService, mentions/*, citations/*. Light: prompts/* (SystemPromptContent, protocol strategies), ToolDefinitionFormatter |
| 7 | Kernel API modules & router | DONE (9 findings) | 2026-09-06 | 0 crit / 1 high / 4 med / 4 low. S7-01 = resource-scope enforced inconsistently across kernel API (bypass by unscoped action / omitted jid). Deep-read all Kernel*Module business logic; router/BaseKernelModule/Events perm paths deferred to slice 8 |
| 8 | Kernel plugins, contributions, permissions | DONE (10 findings) | 2026-09-06 | 0 crit / 1 high / 6 med / 3 low. Deep-read PluginLoader, PluginHost, PluginRegistry, PermissionStore, ContributionRegistry, PluginManifest, KernelEventsModule, KernelMessagesModule (perm paths), KernelAPIRouter, BaseKernelModule, contributionIpc, channels/{Direct,Worker}PluginChannel, pluginProtocol. Light: other Kernel*Module perm checks, I*.ts |
| 9 | Kernel storage, channels, ipc, ui | DONE (10 findings) | 2026-09-06 | 0 crit / 0 high / 6 med / 4 low. Deep-read PrismaPluginStorageRepository, {Direct,Worker}PluginChannel, overlayIpc, panelIpc, contributionIpc, OverlayHost, PanelHost. S9-01/S9-02 = panel event IPC bypasses bus-accessor + permission checks. Light: I*.ts interfaces |
| 10 | App IPC & auth | DONE (10 findings) | 2026-09-06 | 1 crit / 1 high / 4 med / 4 low. S10-01 = swallowed authState read error → hasCreds()=false → wipeAllData on a logged-in user (data loss). S10-02 = silent Signal keystore tx failure. Deep-read auth.ts, ipcHandlers.ts, services/auth/*, ServiceContainer.ts; ipc/*.types.ts trivial |
| 11 | apiServer, search, notification, calls, audio | IN PROGRESS | 2026-09-06 | HTTP surface = apiServer |
| 12 | SDK, tools, data wipe, domain, db, protocol | TODO | — | DataWipeService = data-loss risk |
| 13 | Cross-cutting pass | TODO | — | do only after 1–12 |

## Summary counts

| Severity | Count |
|----------|-------|
| crit | 2 |
| high | 4 |
| med  | 47 |
| low  | 37 |

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

Files read: WhatsAppConnectionManager.ts, WAEventBus.ts, WAEventWiringService.ts, WAEventHandler.ts,
WACatchUpManager.ts, HistorySyncManager.ts, ReceiptService.ts, WASocketFactory.ts, AppStateSyncParser.ts,
secret/{SecretMessageService,MessageEditStrategy,MessageReactionStrategy}.ts,
subscribers/{index,UIBroadcastSubscriber,NotificationSubscriber,PersistenceSubscriber,ReceiptSubscriber,
EmbeddingSyncSubscriber,ContactGroupSubscriber,FavoriteStickerSubscriber,CallEventSubscriber}.ts,
+ cross-refs: kernel/api-modules/KernelEventsModule.ts, index.ts (bootstrap wiring), ServiceContainer.ts,
ipcHandlers.ts (connect call sites), constants.ts.
Not deep-read (thin / peripheral): events/{chat,contact,group,misc,message,sync}Events.ts type files,
WAEventLogger.ts, BaileysPatcher.ts, types/*.

### [S3-01] high — kernel/api-modules/KernelEventsModule.ts:31-36 + services/whatsapp/WhatsAppConnectionManager.ts:62-98
**What:** `KernelEventsModule.onBusConnected(newBus)` only replays `pendingSubscriptions` (subs
requested while the bus was `null`). Subscriptions that were registered live (bus was non-null at
`subscribe` time) live only in `pluginSubscriptions` and are **never re-attached** to a new bus.
`WhatsAppConnectionManager.connect()` does `this.currentBus.removeAllListeners(); this.currentBus =
eventBusFactory()` and calls `busCreatedCallback(newBus)` → `onBusConnected(newBus)` every time it
re-runs.
**Why it's a bug:** `connect()` is re-invoked on user actions — `ipcHandlers.ts:252`
(`set-sync-full-history`), the `wa-connect` IPC path, re-login — not just first boot. After any such
re-connect, every plugin that subscribed to WhatsApp events (e.g. the CodeTantra OTP relay plugin)
silently stops receiving them: `removeAllListeners()` killed the old bus's handlers and nothing
re-registers them on the new bus. No error, no log. `pluginSubscriptions` still lists the plugin as
subscribed, so even a defensive re-subscribe by the plugin would just replace a handler on a bus no
one holds. Persists until full app restart.
**Fix idea:** in `onBusConnected`, iterate `pluginSubscriptions` and `registerOnBus(newBus, …)` for
every existing `{pluginId,event}` in addition to draining `pendingSubscriptions`; or have
`WhatsAppConnectionManager` keep the same bus instance across reconnects and only reset the built-in
subscribers.
**Status:** open

### [S3-02] med — services/whatsapp/subscribers/EmbeddingSyncSubscriber.ts:17-45
**What:** The subscriber registers for `wa-connected`, `wa-sync-progress`, `wa-sync-status`,
`wa-sync-complete` on the `WAEventBus`. Grep of the whole codebase shows **no production code emits
those events on the bus** — only `EmbeddingSyncSubscriber.test.ts`. HistorySyncManager /
WACatchUpManager send `wa-sync-*` via `mainWindow.webContents.send(...)` (renderer IPC), not
`bus.emit(...)`.
**Why it's a bug:** the intended decoupled "pause the embedding pipeline while WhatsApp is
ingesting" mechanism is dead. Embedding-pause currently works only via direct
`embeddingService.setPaused()` calls scattered in `connect()`, `HistorySyncManager`,
`WACatchUpManager`. Any ingestion path that forgets a direct call runs CPU/GPU embedding
concurrently with heavy DB ingestion (the exact thing this subscriber was meant to prevent).
Secondary: if the events were ever wired, `onSyncProgress` unpauses on *any* payload with
`progress >= 100`, including intermediate group-hydration progress callbacks in
`HistorySyncManager.finishSync`, so it would unpause mid-dedup.
**Fix idea:** either emit the `wa-sync-*` domain events on the bus from HistorySyncManager/
WACatchUpManager (single source of truth) and delete the direct `setPaused` calls, or delete
`EmbeddingSyncSubscriber` and keep the direct calls — but don't ship a no-op subscriber that looks
like it's providing the guarantee.
**Status:** open

### [S3-03] med — services/whatsapp/HistorySyncManager.ts:85-88 (also the worker's copy via same file)
**What:** `this.syncTimeout = setTimeout(() => this.finishSync(sock, syncFullHistory),
HISTORY_SYNC_TIMEOUT_MS)` (180 000 ms) is armed **before** `await handleHistorySync(data, …)` and is
not cleared for the duration of that await.
**Why it's a bug:** if a single sync chunk's persist takes longer than 180 s (large
INITIAL_BOOTSTRAP / FULL chunk, slow disk, SQLite lock contention), the safety timer fires *while
`handleHistorySync` is still writing messages*. `finishSync` then: sets `syncComplete = true`,
`isInitialSyncInProgress = false`, unpauses `embeddingService` and the favorite-sticker queue, runs
`groupHydrationService.hydrateGroups`, `identityReconciliationService.deduplicateIdentities()` and
`authSettingsService.setHistorySyncCompleted()` — all concurrent with the unfinished ingestion.
Dedup running against a half-imported dataset can merge/split identities wrongly, and
`history_sync_completed` gets persisted before the sync actually finished, so a later restart skips
re-syncing the missing tail.
**Fix idea:** arm the timeout to cover *inactivity between chunks*, not work in flight — clear it at
the top of `handleSyncChunk` and re-arm only in a `finally` after `handleHistorySync` resolves; or
guard `finishSync` so it no-ops while a chunk is actively being processed.
**Status:** open

### [S3-04] low — services/whatsapp/WhatsAppConnectionManager.ts (connect call sites) & ipcHandlers.ts:252
**What:** `connect()` is invoked as a floating promise in several places: `ipcHandlers.ts:252`
(`set-sync-full-history` → `waConnectionManager.connect()` with no `await`/`.catch`), and
`index.ts` `set-sync-full-history`/reconnect paths. `connect()` does real async work that can reject
(`authSettingsService.hasCreds()`, `chatRepository.countChats()`, `dataWipeService.wipeAllData()`,
`getHistorySyncCompleted()`).
**Why it's a bug:** twin of [S1-01] on the main-process side. A rejection during a settings-driven
reconnect is an unhandled promise rejection and leaves the connection half-torn-down (old bus
already `removeAllListeners()`'d at the top of `connect()`, new bus/worker not started) with nothing
surfaced to the user.
**Fix idea:** `await` + try/catch (or `.catch` with a user-visible error + safe-state restore) at
every `connect()` call site.
**Status:** open

### [S3-05] low — ServiceContainer.ts:332-335, 381-384 (dead duplicated socket stack in main)
**What:** `WASocketFactory`, `WACatchUpManager`, `HistorySyncManager`, `WAEventWiringService` are
constructed in `ServiceContainer` and exported on the container, but in the **main** process
`waEventWiringService.wire()` / `WAEventHandler` are never instantiated or called (grep: `.wire(`
and `new WAEventHandler(` appear only in `workers/whatsapp/bootstrapWorkerRepositories.ts` and
tests). The socket now lives entirely in the worker, which builds its **own**
`historySyncManager` / `eventHandler`.
**Why it's a bug:** latent-bug / maintenance hazard. The main copies hold live references
(`embeddingService`, repos, `getMainWindow`) and pause/timeout logic that never runs, so reading
`ServiceContainer` gives a false picture of where history-sync and embedding-pause happen. A future
change wiring one of these in main would double-process every chunk. The main `HistorySyncManager`'s
embedding-pause is inert (see [S3-02]).
**Fix idea:** delete the unused main-process instances (or the classes if the worker's are the only
real users) and keep a single source of truth.
**Status:** open

### [S3-06] low — services/whatsapp/subscribers/CallEventSubscriber.ts:25-32
**What:** `upsertCallLog({ …, timestamp: BigInt(Math.floor(Date.now() / 1000)) })` — always uses
"now", ignoring `call.date` / `call.offerTime` present on the Baileys `call` payload (the synthetic
call-message path in `WAEventHandler.handleCallEvent` *does* use `call.date`).
**Why it's a bug:** on reconnect Baileys re-delivers queued `call` events (missed calls while
offline); their DB `CallLog.timestamp` is stamped with the reconnect time, not the call time, so
call history and any message enrichment keyed on call time is wrong by minutes-to-hours.
**Fix idea:** prefer `call.date?.getTime()` / offer timestamp; fall back to `Date.now()` only when
absent.
**Status:** open

## Slice 4 — Chats & sync

Files read: historySync.ts, services/sync/{SyncChatsHandler,SyncMessagesHandler,SyncContactsHandler,
SyncRepository,index}.ts, services/chats/{ChatRepository,ChatService,ChatActionService,ChatListEnricher,
GroupHydrationService,GroupMembershipService,ChatMemberRepository,CommunityRepository}.ts,
services/chats/sync/{ChatSyncHandler,CommunitySyncHandler,MembershipSyncHandler}.ts,
+ cross-refs: workers/whatsapp/services/WorkerHistorySyncManager.ts, WorkerMediaService.downloadFavoriteStickersFromSync,
messages/ReactionRepository.bulkSyncReactions, utils/messageUtils.parseBaileysTimestamp.
Not deep-read (thin / interface-only): I*.ts interfaces, types.ts, chats/CommunityRepository trivial.

### [S4-01] med — services/chats/GroupHydrationService.ts:29-44 + services/sync/SyncRepository.ts:79-98, 191-198 + chats/sync/MembershipSyncHandler.ts:228-243
**What:** `hydrateGroups` iterates group batches with `for (i += BATCH_SIZE) { await this.hydrateBatch(...) }`
and **no per-batch try/catch**. `hydrateBatch` → `MembershipSyncHandler` / `ChatSyncHandler` /
`CommunitySyncHandler`, which call `SyncRepository.bulkCreateChats` (`prisma.chat.createMany`),
`bulkCreateIdentityAliases` (`identityAlias.createMany`), `bulkUpdateChats`/`bulkUpdateIdentityAliases`
(`$transaction` of `.update`s). None pass `skipDuplicates` (unsupported on the SQLite provider anyway)
and none are wrapped in a catch inside the handler.
**Why it's a bug:** the worker processes live Baileys events (`contacts.upsert`, `messaging-history.set`
tail, group events) on the **same** event loop, interleaving at the `await new Promise(r => setImmediate(r))`
yield points. A live write that inserts an `IdentityAlias` / `Chat` / `Identity` row (or deletes a Chat)
between a handler's `findIdentityAliases` / `findExistingChats` read and its `createMany` / `$transaction`
write causes a unique-constraint violation (`createMany`) or `P2025` (`update` in a `$transaction`). That
rejection propagates out of the `for` loop in `hydrateGroups`; `finishSync` only `.catch()`es at the
top (`WorkerHistorySyncManager.ts:171`), so **every remaining group batch is skipped** — members,
community links, and LID↔PN aliases for all groups after the failing batch are never hydrated until a
future full re-sync. Silent (one `console.error`).
**Fix idea:** wrap `hydrateBatch` in a per-batch try/catch that logs and continues; make the bulk
create/update repo methods tolerate pre-existing rows (filter against a fresh existence check inside the
same tick, or catch P2002/P2025 and fall back to per-row upsert like `ReactionRepository` does).
**Status:** open

### [S4-02] med — services/chats/ChatListEnricher.ts:22-52 (`getChatList`)
**What:** After fetching exactly `pageSize` chats (`findChatsPaginated(skip, take)`), the method appends
**every** chat returned by `findChatsByCommunityJids(...)` for any community touched by the page — with
no limit and no relation to the `skip`/`take` window — then enriches and returns the whole set.
**Why it's a bug:** (1) a "page" can return far more than `pageSize` rows; a community with 60 subgroups
pulls all 60 in whenever one member chat lands on the page, doing 60× the per-chat enrichment work
(`findLastMessage` + `findLastReaction` + name resolution each). (2) Those injected sibling chats are
**not excluded from their own natural page**, so the same `jid` is returned on multiple pages. An
infinite-scroll renderer that concatenates pages gets duplicate chat rows (duplicate React keys / repeated
entries) unless it dedups by jid defensively. (3) `skip`/`take` count only the base query, so the injected
rows shift nothing — pagination cannot be reasoned about.
**Fix idea:** resolve community grouping in the renderer, or fetch community siblings once for the whole
list and dedupe by jid across the already-emitted set / track a cursor; never return rows outside the
requested window from a paginated call.
**Status:** open

### [S4-03] med — services/sync/SyncMessagesHandler.ts:253-291 (`_parseBatch`) + 216-238 (`_resolveSenderId`)
**What:** `_parseBatch` loops over the 200-message batch and does `await this._resolveSenderId(...)` for
every message serially. For a never-before-seen participant `_resolveSenderId` runs
`await contactService.upsertContact({ id })` **then** `await contactService.getIdentityIdByJid(id)` — two
sequential DB round-trips — before the loop can advance.
**Why it's a bug:** (1) Performance: an INITIAL_BOOTSTRAP / FULL chunk with thousands of messages from
many distinct senders becomes thousands of strictly-sequential DB round-trips (the `identityCache` only
helps repeats within the same `processMessages` call); this is the kind of "await in a loop that should be
batched" the checklist calls out, and it runs while `embeddingService` and the sticker queue are paused
and the 180 s `finishSync` safety timer is ticking (feeds [S3-03]). (2) Correctness smell: `upsertContact`
followed by a separate `getIdentityIdByJid` is check-then-act on async state — a concurrent identity
merge/dedup between the two awaits can make the second call return an id that is about to be deleted, or
`null` (then `senderId` is silently dropped to `null` and the message is stored with no sender).
**Fix idea:** collect all distinct participant JIDs for the batch up front, do one bulk
upsert + one bulk `batchGetIdentityIds`, then resolve from the map with no per-message awaits (the
`MembershipSyncHandler` batch pattern).
**Status:** open

### [S4-04] med — services/chats/ChatService.ts:42-44 (`upsertChat`)
**What:** `if (typeof update.unreadCount === 'number' && update.unreadCount === 0) data.unreadCount = 0`
— the only unread value this handler will ever persist is `0`. Any `chats.update` / `chats.upsert`
carrying `unreadCount > 0` is dropped.
**Why it's a bug:** `chats.update` is how WhatsApp propagates "marked unread on another device" and the
authoritative unread count after a multi-device reconciliation. Because the branch ignores every non-zero
value, a chat the user marked unread on their phone (or whose server-side unread count jumped) stays
showing as read in this client, and the count can only ever be driven by the local `incrementUnread`
path. There is no comment saying non-zero is intentionally owned elsewhere.
**Fix idea:** persist `unreadCount` whenever it is a number `>= 0` (WhatsApp uses `-1` for "unknown" —
skip only that), or document why non-zero is deliberately ignored.
**Status:** open

### [S4-05] low — services/sync/SyncMessagesHandler.ts:73, 96, 108 (`importedMessages`)
**What:** `importedMessages` is typed `Message[]` but is filled with `push(...(standardMessages as unknown
as Message[]))` where `standardMessages` are freshly parsed `SyncMessageRow` objects, not DB rows. They
are pushed **before** `bulkSyncMessages` is awaited, and `bulkSyncMessages` swallows its errors to
`console.error` ([S2-10]).
**Why it's a bug:** the array is handed to `WorkerMediaService.downloadFavoriteStickersFromSync`, which
queues a favorite-sticker download keyed on `msg.id`. If the batch's `bulkSyncMessages` actually failed,
downloads are queued for message ids that are not in the DB (later `queueFavoriteStickerDownload` /
persistence steps no-op or error). It also includes revoked/edited/`ciphertext` rows as "imported".
Works today only because both consumers read just `.id` and `.content`; any consumer that touches a real
`Message` column (`remoteJid`, `createdAt`, …) will get `undefined`.
**Fix idea:** return the rows actually persisted (or their ids) from `bulkSyncMessages`, and only push
after it resolves; drop the `as unknown as` cast by giving the function an honest return type.
**Status:** open

### [S4-06] low — services/messages/ReactionRepository.ts:80-122 (`bulkSyncReactions`) as driven by SyncMessagesHandler.ts:99-103
**What:** `bulkSyncReactions` keeps only reactions whose `targetId` already exists in the DB (or, per its
doc comment, the current batch — the `_currentBatchIds` param is actually unused/dead). It is invoked once
per 200-message batch, and standard messages of a batch are inserted just before its reactions are
processed.
**Why it's a bug:** a reaction collected in batch *k* whose target message is only inserted in batch
*k+1..n* of the **same** history chunk is silently discarded (`existingMessageIds` miss → filtered out,
`valid.length === 0` → `return`). There is no deferral/retry, so that reaction is lost until the exact
sticker/message is re-encountered in a later sync. History payloads don't guarantee a message precedes
its inline `reactionMessage`.
**Fix idea:** accumulate unresolved reactions across batches within a `processMessages` call and retry
them after all message batches are inserted; or run one reaction pass at the end.
**Status:** open

### [S4-07] low — services/sync/SyncChatsHandler.ts:131 & SyncContactsHandler.ts:124
**What:** `processChats` returns `chats.length` and `processContacts` returns `contacts.length`, ignoring
the local `count` that skips entries with no `id`.
**Why it's a bug:** cosmetic only — the values become `chatCount` / `contactCount` in the
`[HistorySync]` progress log and the `HistorySyncResult`, overstating how many rows were actually
upserted when the payload contains id-less entries. No functional impact found.
**Fix idea:** return the real processed count.
**Status:** open

### [S4-08] low — services/chats/GroupHydrationService.ts:40-42
**What:** `const progressVal = 95 + Math.round((processedCount / totalGroups) * 4)` — the multiplier is
`4`, so the reported progress asymptotes to `99` and the loop never emits `100`.
**Why it's a bug:** minor UX — the group-hydration phase of a sync visibly stalls at 99%. `finishSync`
does later publish an explicit `progress: 100`, so it self-corrects, but only after
`deduplicateIdentities()` (which can take seconds-to-minutes) completes.
**Fix idea:** use `* 5` (95→100) or emit an explicit 100 when `processedCount === totalGroups`.
**Status:** open

### [S4-09] low — services/chats/ChatMemberRepository.ts:13-52 (`upsertChatMember`) via GroupMembershipService.ts:55-95
**What:** `upsertChatMember` issues `chat.findUnique` + (maybe `chat.create` + re-`findUnique`) +
`identity.findUnique` + `chatMember.upsert` — 3–5 statements per member — and
`GroupMembershipService.syncGroupMembers` calls it in a `for` loop with `await` per participant (yield
every 5).
**Why it's a bug:** performance on the live path (`groups.update` / metadata refresh for a large group):
a 500-member group is ~2000 sequential statements. The batch sync path (`MembershipSyncHandler`) already
does this set-based; the live path does not. Not incorrect, just slow and lock-hungry while other worker
writes are queued.
**Fix idea:** give `syncGroupMembers` the same batched pre-fetch + `bulkUpsertChatMembers` treatment as
`MembershipSyncHandler`.
**Status:** open

## Slice 5 — Contacts

Files read: ContactService.ts, ContactNameResolver.ts, IdentityReconciliationService.ts,
LidPnLinker.ts, ProfileSyncService.ts, AliasRepository.ts, IdentityRepository.ts,
LidMapRepository.ts, ContactCache.ts, JidStrategies.ts, prisma/schema.prisma (Identity/
IdentityAlias/Message/Reaction/ChatMember relations), + cross-refs: historySync.ts,
services/whatsapp/HistorySyncManager.ts (finishSync), workers/whatsapp/services/
WorkerHistorySyncManager.ts.
Not deep-read (thin / interfaces only): I*.ts interface files, index.ts.

### [S5-01] med — services/contacts/IdentityReconciliationService.ts:90-158 (`deduplicateIdentities` merge body)
**What:** The 6-step stub→keep merge (re-point aliases, re-point messages, merge ChatMember
rows, merge Reaction rows, enrich survivor, delete stub) runs as ~a dozen independent
`await this.prisma.*` calls with **no enclosing `prisma.$transaction`**. The `try/catch`
only does `skipped++` and logs.
**Why it's a bug:** if any step after step 1 throws — lock contention, an FK/unique
conflict, or (per [S3-03]) a concurrent history-sync write inserting a new `Message`/
`Reaction` with `senderId = stubId` between step 2 and step 6 — the merge aborts
half-applied: the stub's aliases and/or messages are already re-pointed to `keepId`, but
the stub `Identity` row is never deleted (step 6 skipped). Result is a dangling alias-less
`Identity` stub plus a partially-merged person. The method's docstring claims "fully
idempotent / safe to call multiple times", but a re-run won't find the stub again (it now
has no LID alias / no pushName-matching rows) so the orphan is never collected. `stub.delete`
in step 6 can itself throw P2003 if a concurrent write re-added a child row, making the
partial state the *common* failure mode under the concurrency window [S3-03] describes.
**Fix idea:** wrap steps 1-6 for each stub in a single `prisma.$transaction([...])` (or
interactive tx) so a failure rolls back to the pre-merge state; keep the per-stub
`try/catch` outside the tx for the `skipped++` bookkeeping.
**Status:** open

### [S5-02] med — services/contacts/ContactCache.ts:5,26 + IdentityReconciliationService.ts (no cache signal) vs services/whatsapp/HistorySyncManager.ts:186
**What:** After `deduplicateIdentities()` the **worker** process calls
`contactService.clearCaches()` (WorkerHistorySyncManager.ts:183 / HistorySyncManager.ts:186),
but the dedup only runs in the worker and only the worker's `ContactCache` is cleared. The
**main** process has its own `ContactService`/`ContactCache` instance whose
`identityIdCache` (`Map<jid, number>`, never TTL'd, only cleared by `clearCaches`) is
populated continuously during sync by `PersistenceSubscriber` → `upsertContact` /
`getIdentityIdByJid` for events forwarded from the worker. Nothing tells the main process
to clear its cache when the worker merges identities.
**Why it's a bug:** every stub `Identity` the worker deletes during post-sync dedup leaves
the main process caching `lidJid → stubId` for a row that no longer exists. Subsequent
main-process `identityRepository.updateIdentity(stubId, …)` (e.g. from a live
`contacts.update` or `group participants` event, or ProfileSyncService writing a
`profilePictureUrl`) throws Prisma P2025 (unhandled in several call sites — see
ProfileSyncService.ts:88 `.catch` logs, but ContactService.createOrUpdateIdentity /
registerMe do not); `findIdentityById(stubId)` returns `null`, so name resolution falls
back to the bare phone number for that contact. Persists until app restart or the next
full history sync.
**Fix idea:** emit a "identities-deduplicated" signal from the worker to the main process
(via the event bus / IPC) after `deduplicateIdentities`, and have the main process call
`contactService.clearCaches()` on it; or make `deduplicateIdentities` itself return the
set of merged stub ids so callers can do a targeted cache eviction in both processes.
**Status:** open

### [S5-03] low — services/contacts/LidPnLinker.ts:40-81 (`linkLidAndPn` relational sync)
**What:** Classic check-then-act with no transaction: `findIdentityByPhoneNumber(cleanPn)` /
alias lookups, then one of `createIdentity({ phoneNumber: cleanPn })` (line 77) or
`updateIdentity(identityId, { phoneNumber: cleanPn })` (line 73). Neither write handles the
`phoneNumber` unique-constraint violation (P2002) the way
`ContactService.createOrUpdateIdentity` does.
**Why it's a bug:** `linkLidAndPn` is invoked concurrently from multiple fire-and-forget
paths — `ContactNameResolver` tier-3 (`runtime.cache`), `IdentityReconciliationService.
reconcileLidPnFromJids`, `SyncContactsHandler.processLidPnMappings`, `registerMe`'s lidMap
path — often for the same PN in the same tick during sync. Two racers that both observe
"no PN identity, no LID alias" both hit the `create`, and the loser rejects with P2002;
the `updateIdentity` branch rejects the same way if another identity grabbed `cleanPn`
first. All current callers `.catch()` and only log, so the effect is a silently dropped
link that round (the LID stays unlinked until re-encountered) — and dropped links are
exactly what `deduplicateIdentities` then has to clean up.
**Fix idea:** catch P2002 and fall back to re-reading the now-existing identity (mirror
`ContactService.createOrUpdateIdentity`), or route all identity creation through a single
`upsert` on `phoneNumber`.
**Status:** open

### [S5-04] low — services/contacts/ContactNameResolver.ts:105-113 (`batchResolveNames` tier-3)
**What:** When a `@lid` JID is resolved to a PN via the signal runtime cache, the code
comments "Re-check aliases just in case PN is known" and does
`aliases.find(a => a.jid === pn)` — but `aliases` was only fetched for the *requested*
JID list, which does not contain the just-discovered `pn`. It never queries the DB /
`repository.findIdentityAliases([pn])`.
**Why it's a bug:** if the discovered PN belongs to a known saved contact (has a
`displayName`), that name is still not used — the JID renders as the bare number
(`pn.split('@')[0]`). It only self-heals on a *later* `batchResolveNames` call, after the
fire-and-forget `linkLidAndPn` has created the LID alias. First render after a fresh LID
sighting is wrong.
**Fix idea:** in the tier-3 branch, do a targeted `repository.findIdentityAliases([pn])`
(or reuse the batched query by adding discovered PNs to the chunk in a second pass) before
falling back to the raw number.
**Status:** open

### [S5-05] low — services/contacts/ProfileSyncService.ts:7,45 (`imageCache`)
**What:** `private imageCache = new Map<string, string>()` is an unbounded, never-evicted
per-instance map; entries are only ever added (line 45), never removed, and `clearCaches`
on `ContactService` does not touch it. Negative results (fetch returned no URL / threw)
are not cached.
**Why it's a bug:** (1) slow memory growth over a long-running session proportional to the
number of distinct contacts/groups whose full-res avatar is ever viewed; stale URLs are
served for the session lifetime even after the contact changes their picture (only
`forceRefresh` bypasses, and nothing invalidates on `contacts.update`). (2) every lookup
for a contact with no avatar (`item-not-found`) re-hits `sock.profilePictureUrl` over the
socket on each call — no negative caching, unlike the DB-backed preview path.
**Fix idea:** bound the map (LRU / max size) or key it into the existing
`ContactCache.clear()` lifecycle; cache a sentinel for "no picture" with a short TTL.
**Status:** open

## Slice 6 — AI

Files read: AIService.ts, providers/{Gemini,Groq,Mistral,DeepSeek,LMStudio}Provider.ts,
AIKeyService.ts, FSKeyStorage.ts, AIChatSessionService.ts, AIChatExportService.ts,
AIToolService.ts, mentions/{AIMentionEnricher,NoOpMentionEnricher}.ts +
mentions/strategies/{Group,DM,Default,Community}EnrichmentStrategy.ts,
citations/{CitationSessionManager,CitationEmitter}.ts, SystemPromptBuilder.ts.
Light: prompts/{SystemPromptContent,ReactProtocolStrategy,StandardProtocolStrategy,
ToolDefinitionFormatter}.ts, I*.ts interfaces.

### [S6-01] crit — AIKeyService.ts:8-13
**What:** Live third-party API keys for Gemini, Groq, Mistral and DeepSeek are hardcoded as
`AIKeyService.DEFAULTS` and committed to the repo. They are applied as the default key for every
install and are also copied into the plaintext `provider_keys.json` on the first `saveKey`.
**Why it's a bug:** real credential exposure. Anyone with repo/source access (the app ships the
bundled JS) can extract and abuse these keys — quota theft, billing, and the keys are shared across
the entire user base so one abuse report kills AI for everyone. They cannot be rotated without a
release.
**Fix idea:** remove the secrets from source; ship with no default key and require the user (or a
server-side proxy) to supply one; rotate the leaked keys immediately.
**Status:** open

### [S6-02] med — providers/GroqProvider.ts:46, MistralProvider.ts:48, DeepSeekProvider.ts:47 (`formatMessages`)
**What:** History role mapping is `msg.role === 'model' || msg.role === 'assistant' ? 'assistant' :
'user'`. The actual history role used throughout the app is `'ai'` (see `IAIChatSessionService`
`role: 'user' | 'ai'`, `useAIStream.ts` `role: 'ai' as const`, and `AIService.generateResponseWithTools`
which pushes `{ role: 'ai' }`). `'ai'` matches neither branch, so **every prior assistant turn is
sent to Groq / Mistral / DeepSeek as a `user` message**.
**Why it's a bug:** multi-turn conversations with these three providers lose the user/assistant
structure — the model sees a pile of consecutive "user" turns and its own past answers attributed to
the user. Degrades coherence badly and, in `generateResponseWithTools`, the assistant's
`<tool_call>` turn is fed back as a user turn, so the model often re-emits the same call → loops to
`maxTurns`. Gemini (`role === 'user' ? 'user' : 'model'`) and LMStudio (`role === 'user' ? 'user' :
'assistant'`) handle `'ai'` correctly, so this is provider-specific and easy to miss.
**Fix idea:** treat `'ai' | 'model' | 'assistant'` as assistant in all three providers (or normalize
role once in `AIService` before dispatch).
**Status:** open

### [S6-03] med — AIService.ts:365 (`generateResponseWithTools`)
**What:** `const maxTurns = options?.maxTurns || 1000000`. No real ceiling on the tool-execution loop.
**Why it's a bug:** a model that keeps emitting `<tool_call>` (misbehaving local model, or the
role-confusion in [S6-02]) runs up to a million provider round-trips — each a paid/rate-limited API
call and a tool execution — before the loop throws. Effectively a runaway cost / hang with no
user-visible progress or abort wired into the loop (`abortResponse` aborts only the current
in-flight provider call; `tool.execute` between turns is not cancellable).
**Fix idea:** default `maxTurns` to a small number (e.g. 10-25); check the request's `AbortSignal`
at the top of each loop iteration and bail.
**Status:** open

### [S6-04] med — providers/GeminiProvider.ts:51-75 (`generateResponse`) & 77-108 (`generateResponseStream`)
**What:** Both methods receive `_signal` / `signal` but never pass an abort signal to the
`@google/genai` SDK call (`generateContent` / `generateContentStream` take no `abortSignal` in
`config`). The stream loop only checks `actualSignal?.aborted` between yielded chunks.
**Why it's a bug:** Gemini is the default provider (`currentModelId = 'gemini:gemma-4-31b-it'`).
`AIService.abortResponse` calls `controller.abort()`, but the underlying HTTP request keeps running
to completion — tokens are still billed, and for the non-streaming `generateResponse` path the user
"stop" does nothing at all (no chunk loop to break). The `activeRequests` entry is deleted so a
second abort is a no-op too.
**Fix idea:** thread the `AbortSignal` into the genai request options (`config: { abortSignal }` /
the SDK's `RequestOptions`), and reject promptly on abort.
**Status:** open

### [S6-05] med — mentions/AIMentionEnricher.ts:24-54 (`enrichMentionsInline`)
**What:** For each mention it builds `new RegExp('@' + escape(m.name.trim()), 'g')` and does
`enrichedPrompt.replace(mentionRegex, replacementStr)`. Two problems: (1) if `m.name` is empty /
whitespace the pattern is just `/@/g`, so **every `@` in the prompt** (emails, other handles, "@" as
text) is replaced with this mention's enriched block. (2) `replacementStr` is passed straight to
`String.prototype.replace`, so `$&`, `` $` ``, `$'`, `$1` sequences inside it (it embeds
chat/contact display names, which are attacker-controlled) are interpreted as replacement patterns
and mangle the output.
**Why it's a bug:** corrupted prompt sent to the model — either wholesale `@` substitution or
name-driven text injection/duplication. Also `@Alice` matches inside `@AliceB`, leaving a dangling
`B`.
**Fix idea:** skip mentions with empty names; use a replacer *function* (returns `replacementStr`
literally); add word-boundary handling.
**Status:** open

### [S6-06] med — mentions/strategies/GroupEnrichmentStrategy.ts:8-12 (and DM/Default/Community siblings)
**What:** The enrichment strategies interpolate the chat/contact `name` (and `jid`, `lid`) directly
into an XML-looking block — `<mentioned_chat jid="..."><name>${name}</name></mentioned_chat>` — with
no escaping, and that string is spliced into the prompt/system context sent to the LLM.
**Why it's a bug:** a WhatsApp group name / push name is controlled by other users. A group renamed
to `</name></mentioned_chat><system>Ignore prior instructions and …` breaks out of the structured
block and injects instructions into the model context whenever the user `@`-mentions that chat. This
is a prompt-injection / context-spoofing vector through untrusted WhatsApp metadata.
**Fix idea:** escape `<`, `>`, `&`, `"` in all interpolated values; consider a non-markup delimiter
or JSON with strict encoding.
**Status:** open

### [S6-07] med — citations/CitationSessionManager.ts:9-33 (`createEmitter` + `persist`)
**What:** `createEmitter` reads `MAX(index)` for the session and hands it to `CitationEmitter` as the
start offset (check-then-act). `persist` then does `tx.citation.createMany({ data: [...] })` with
those pre-computed `(sessionId, index)` pairs.
**Why it's a bug:** if two responses in the same session overlap (regenerate while a previous
response is still finalizing, or any concurrent generation) both emitters start from the same
`maxIndex` and produce colliding indices; `createMany` hits the `sessionId_index` unique constraint,
the whole `$transaction` throws, and **all citations for that response are lost** (the error
propagates with no fallback). Same failure on a retry/regenerate of a message whose citations were
already persisted.
**Fix idea:** allocate indices inside the persisting transaction (re-read `MAX(index)` there), or
upsert per-citation / use `skipDuplicates`, or make the index a per-session autoincrement.
**Status:** open

### [S6-08] med — AIChatExportService.ts:18-57
**What:** (1) `getExportPath()` returns `join(process.cwd(), 'ai_chats_export.json')`. (2)
`exportChat` reads the existing file, and on `JSON.parse` failure just logs and continues with
`exports = []`, then `writeFileSync` overwrites the file. (3) all writes are non-atomic single
`writeFileSync` calls; `.findIndex` on a non-array parse result throws outside the try.
**Why it's a bug:** in a packaged Electron app `process.cwd()` is not the app dir — it can be `/`,
`C:\Windows\System32`, or another read-only location — so exports land somewhere unexpected or throw
`EACCES`. And a single corrupt/partial existing export file (or a concurrent export) causes the next
`exportChat` to silently **destroy every previously exported chat** rather than fail loudly.
**Fix idea:** write under `app.getPath('userData')` (or a user-chosen path via save dialog);
back up / refuse on parse failure instead of replacing; write to a temp file + rename.
**Status:** open

### [S6-09] low — AIChatSessionService.ts:113-145 (`saveMessages`)
**What:** Persistence is "delete all messages for the session, then `createMany` the supplied
array", run on every save. Message rows get fresh ids each time.
**Why it's a bug:** (1) the renderer is the sole source of truth for the array; a save fired from a
stale closure or racing another save (autosave during streaming + rename/clone) truncates or
reorders history with no guard. (2) any external reference to a message id (e.g. a future
citation→message link, or an in-flight `getSession` result) is invalidated on every keystroke-driven
autosave. (3) no `orderIndex` uniqueness / monotonic check — duplicate indices if the caller sends
them.
**Fix idea:** diff-based upsert keyed by a stable client id, or at least an optimistic-concurrency
token (session `updatedAt`) so a stale save is rejected.
**Status:** open

### [S6-10] low — AIKeyService.ts:52-60, FSKeyStorage.ts:25-36, AIChatSessionService.ts:161-167
**What:** `provider_keys.json` and `ai_preferences.json` are read with "parse fails → silently fall
back to defaults" and written with a single non-atomic `writeFileSync`. `AIKeyService.saveKey`
catches the persist error and returns `void`; `AIService.setProviderKey` then returns `true`
regardless.
**Why it's a bug:** a crash/power-loss mid-write, or any manual/rogue corruption of these files,
silently resets **all** API keys back to the committed defaults and **all** AI preferences (model,
think-mode, context length) to their defaults on next launch, with only a `console.error`. And the
settings UI reports "key saved" even when the write to disk threw (disk full, permissions), so the
user's key is lost on restart.
**Fix idea:** temp-file + atomic rename; on parse failure keep a `.corrupt` backup and surface an
error rather than resetting; propagate `saveKey` failure to the IPC caller.
**Status:** open

### [S6-11] low — providers/LMStudioProvider.ts:19-49 (`getOrLoadModel`)
**What:** No lock / in-flight de-dup around `this.client.llm.load`. Concurrent calls for a
not-yet-loaded model both `await load(...)` and both `set` the map (one model instance leaks until
its TTL). On a context-length mismatch it `unload`s the shared model key unconditionally.
**Why it's a bug:** two AI requests started close together (e.g. a chat message plus a background
system generation) double-load the model — wasted VRAM, and the `unload` path in a concurrent
context-length switch can pull the model out from under an already-running `model.respond(...)`,
failing that prediction.
**Fix idea:** cache the in-flight load promise per `modelKey`; serialize load/unload for a key;
don't unload while a prediction against it is outstanding.
**Status:** open

## Slice 7 — Kernel API modules & router

Files read: KernelAPIRouter.ts, IKernelAPIRouter.ts, KernelBootstrapper.ts,
api-modules/{IKernelModule,KernelErrors,BaseKernelModule,KernelChatsModule,KernelContactsModule,
KernelMessagesModule,KernelAIModule,KernelStorageModule,KernelUIModule,KernelLogModule,
KernelEventsModule}.ts, permissions/PermissionStore.ts (isResourceAllowed semantics),
services/ai/AIToolService.ts (ToolRegistry.registerTool). KernelAPIRouter / BaseKernelModule /
KernelEventsModule / KernelMessagesModule permission paths already covered by slice 8; this slice
focused on per-action business logic + resource-scope consistency.

### [S7-01] high — api-modules/KernelMessagesModule.ts:89-108,132-172 + KernelChatsModule.ts:23-28 + KernelContactsModule.ts:33-42 + KernelEventsModule.ts:70-89
**What:** `requireResourceScope` (per-jid allow/deny list from `PermissionStore`) is enforced
inconsistently across the kernel API. Several actions that operate on a chat's data never call it,
or only call it behind an optional `if (jid)`:
- `KernelMessagesModule` `edit` / `forward` — resource scope checked only `if (jid)`; a plugin that
  simply omits the optional `jid` field edits/forwards **any** message in the DB by global
  `messageId`, and `forward` then delivers it to arbitrary `targetJids`.
- `KernelMessagesModule` `downloadMedia` / `getReceipts` — take only `messageId`, never call
  `requireResourceScope` at all. A plugin whose `messages:read` scope is restricted to chat A can
  pull media bytes / read receipts for messages in chat B.
- `KernelChatsModule` `getList` — no `requireResourceScope`; a plugin scoped to one chat still gets
  the full chat list (names, last-message preview text) for every chat.
- `KernelContactsModule` `batchGetByJids` — no per-jid scope check, unlike `getByJid` right above
  it which does enforce it. Pass arbitrary jids → resolve names for contacts outside the allow-list.
- `KernelEventsModule` `subscribe` — capability `events:<event>` is checked but there is no
  resource-scope filter on the payloads, so a plugin restricted to chat A receives `messages.upsert`
  / `chats.update` / receipts for **all** chats (sanitized but complete).
**Why it's a bug:** `PermissionStore.isResourceAllowed` returns `true` when no scope is set, so a
scope only matters if the user configured one — and when they do (e.g. "this OTP plugin may only
read the CodeTantra chat"), the restriction is trivially bypassed by choosing the unscoped action
or dropping the optional jid. The whole point of per-resource scoping (limiting an untrusted 3rd
-party plugin to a subset of chats) is defeated. Silent — the plugin just gets the data.
**Fix idea:** make every data-bearing action resolve and check the owning jid: for message-id-only
actions, look the message up and scope on its `remoteJid` before acting; require `jid` (not
optional) on `edit`/`forward`; scope `getList`/`batchGetByJids` results by filtering to allowed
resources; filter event payloads per subscription scope (or document that `events:*` is all-or
-nothing and gate it harder).
**Status:** open

### [S7-02] med — api-modules/KernelMessagesModule.ts:64-87 (`sendMedia`)
**What:** `filePath` comes straight from the plugin payload and is passed to
`messageActionService.sendMediaMessageWorkflow(sock, jid, filePath, …)`, which reads that path off
disk and uploads it. No validation that the path is inside a plugin-owned / sanctioned directory.
**Why it's a bug:** a plugin with only `messages:send` scoped to a chat **it controls** can set
`filePath` to any file the app process can read — `provider_keys.json`, the SQLite DB, the
permissions file, `~/.ssh/id_rsa`, arbitrary user documents — and exfiltrate it by sending it as
media to its own chat / a chat the attacker owns. `messages:send` is a much lower bar than
"read any local file".
**Fix idea:** restrict `sendMedia` source paths to a per-plugin staging dir (or a path the user
explicitly picked via a dialog), resolve+normalize and verify containment before reading.
**Status:** open

### [S7-03] med — api-modules/KernelAIModule.ts:44-92 (session actions)
**What:** `createSession` / `listSessions` / `getSession` / `renameSession` / `deleteSession` gate
only on the `ai:chat` capability. There is no notion of which sessions belong to which plugin (the
service is keyed by session `id` only), and no resource scope.
**Why it's a bug:** any plugin holding `ai:chat` (needed just to call the model) can
`listSessions` to enumerate every AI chat the user has had in the main app UI, `getSession` to read
their full contents, `renameSession`, or `deleteSession` to wipe them all. Cross-tenant read of
private user data + data loss, from a capability that looks like "may talk to the LLM".
**Fix idea:** tag sessions with an owner (`pluginId` or `'user'`) and scope all session actions to
the caller's own sessions; or split "manage sessions" into its own capability that builtins get and
3rd-party plugins do not.
**Status:** open

### [S7-04] med — api-modules/KernelAIModule.ts:106-155 (`registerTool`) + services/ai/AIToolService.ts:10-12
**What:** `registerTool` does `toolRegistry.registerTool(tool)` → `this.tools.set(tool.name, tool)`
— last writer wins, no name-collision check, no namespacing by plugin. Nothing ever removes the
tool (no `unregisterTool` in `IToolRegistry`, no call on plugin unload).
**Why it's a bug:** (1) A plugin with `ai:tools:register` can register a tool named `read_messages`,
`execute_script`, `query_database`, … and **shadow the builtin** of that name (registered earlier
by `AIToolInitializer`). The user's own AI assistant then silently invokes the plugin's
implementation — arbitrary code / data interception under a trusted tool name. (2) Tools registered
by a plugin persist in the registry after the plugin is unloaded/uninstalled (leak + stale
`execute` closure that calls a dead channel → every future call returns the "channel is not
available" error string to the model).
**Fix idea:** reject registration of a name that already exists (or namespace plugin tools as
`<pluginId>/<name>`); add `unregisterTool` and call it from `PluginHost.unload`.
**Status:** open

### [S7-05] med — api-modules/KernelUIModule.ts:89-99 (`overlay:send`, `overlay:close`)
**What:** Unlike `showOverlay` (`ui:overlay`) and the panel actions (`ui:panel` + pluginId-scoped),
the `overlay:send` and `overlay:close` cases call **no `requireCapability`** and pass only the
caller-supplied `overlayId` to `overlayHost.sendToOverlay` / `closeOverlay` — no check that the
overlay belongs to the calling plugin.
**Why it's a bug:** any loaded plugin, including one with zero granted capabilities, can push
arbitrary `event`/`data` into another plugin's overlay webview (spoof messages the overlay's own UI
trusts as coming from its kernel side) or close another plugin's overlay at will. Cross-plugin UI
tampering across a trust boundary.
**Fix idea:** require `ui:overlay`, and have `OverlayHost` verify the `overlayId` was created by the
same `pluginId` before routing.
**Status:** open

### [S7-06] low — api-modules/KernelAIModule.ts:94-104 (`callTool`)
**What:** `callTool` checks `ai:tools:call` + resource scope on the tool **name**, then runs
`tool.execute(args)` with the plugin's raw args. The builtin tools (`read_messages`,
`query_database`, `execute_script`, `message_action`, `chat_action`) run with full app privilege and
do no per-caller chat scoping.
**Why it's a bug:** a plugin granted `ai:tools:call` for e.g. `query_database` can run arbitrary
read SQL over the whole message DB, and `message_action` / `chat_action` / `execute_script` give
write/exec — completely sidestepping the `messages:*` / `chats:*` capability + resource-scope
system that the rest of the module enforces. Effectively `ai:tools:call` on the wrong tool is a
privilege-escalation grant.
**Fix idea:** treat the powerful builtins as not plugin-callable (allow-list which tools
`callTool` may reach), or run them with the caller's resource scope applied.
**Status:** open

### [S7-07] low — api-modules/KernelLogModule.ts:11-30
**What:** No `requireCapability` (any plugin can log), and `data` is `JSON.stringify`'d into the log
line with no size cap or depth guard; `logLevel` can be spoofed via the payload.
**Why it's a bug:** a noisy/malicious plugin can flood the main-process console / log file
(disk-fill, log-rotation churn, obscuring real errors) and `JSON.stringify` on a huge or cyclic
`data` array throws inside `handle` (cyclic) or spikes memory (huge). Minor, but it is an
unauthenticated entry point.
**Fix idea:** gate on a `log` capability (or rate-limit per plugin), cap serialized length, wrap
the stringify in try/catch.
**Status:** open

### [S7-08] low — api-modules/BaseKernelModule.ts:40-47 (`serialize`) + KernelEventsModule.ts:111-135 (`sanitizeForPlugin`)
**What:** `serialize` does `JSON.parse(JSON.stringify(data, replacer))` and `sanitizeForPlugin`
recurses over every key with no depth limit and no visited-set.
**Why it's a bug:** a Baileys/event payload (or a plugin-supplied object echoed back) containing a
circular reference makes `serialize` throw `TypeError: Converting circular structure to JSON`
(surfaces to the plugin as `INTERNAL_ERROR`, and for event delivery the throw is inside the bus
handler), and a deeply nested structure makes `sanitizeForPlugin` blow the stack and crash the
main process. Both currently rely on WA payloads happening to be acyclic and shallow.
**Fix idea:** add a `seen` WeakSet + max-depth cutoff to `sanitizeForPlugin`; guard `serialize`
with try/catch and a depth/size bound.
**Status:** open

### [S7-09] low — api-modules/KernelChatsModule.ts:31-44 etc. (payload destructuring before validation)
**What:** Many actions do `const { jid } = payload as { jid: string }` before any check. When a
plugin sends `null`/omitted payload this throws `TypeError: Cannot destructure property 'jid' of
'payload' as it is null`, caught by the router as a generic `INTERNAL_ERROR`; when it sends
`{ jid: 123 }` the wrong type flows into `requireResourceScope` / service calls unchecked.
**Why it's a bug:** no input validation at the trust boundary — malformed IPC/plugin payloads
produce confusing `INTERNAL_ERROR`s instead of `BAD_REQUEST`, and non-string `jid`/`messageId`
values reach SQL/service layers. Low impact (mostly DX / error clarity) but it is the IPC trust
boundary.
**Fix idea:** validate payload shape per action (zod/assert) and return a `BAD_REQUEST`
`KernelError` on mismatch.
**Status:** open

## Slice 8 — Kernel plugins, contributions, permissions

Files read: plugins/{PluginLoader,PluginHost,PluginRegistry,PluginManifest,PluginContext}.ts,
permissions/PermissionStore.ts, contributions/{ContributionRegistry,ContributionPoints,WhenCondition}.ts,
kernel/{KernelAPIRouter,KernelBootstrapper}.ts, api-modules/{BaseKernelModule,KernelEventsModule,
KernelMessagesModule}.ts, ipc/contributionIpc.ts, channels/{DirectPluginChannel,WorkerPluginChannel}.ts,
protocol/pluginProtocol.ts. Light: other Kernel*Module permission paths, I*.ts interfaces.

### [S8-01] high — plugins/PluginLoader.ts:39, 49-54, 57, 73 + ipc/contributionIpc.ts:135-161
**What:** `manifest.id` and the IPC-supplied `id` / `scextPath` are used to build filesystem paths
with no validation. `validateManifest` only checks `typeof id === 'string'` and non-empty — never
that it is a safe path segment. `install` does `path.join(this.baseDir, manifest.id)` then
`mkdirSync` + `zip.extractAllTo(pluginDir, true)`; `uninstall(id)` does
`fs.rmSync(path.join(this.baseDir, id), { recursive: true, force: true })`; `load(id)` joins
`manifest.main` onto the plugin dir and does `new Worker(entryPath)`. The `extension:uninstall`,
`extension:install`, `extension:reload` IPC handlers pass the renderer-supplied `id` / path straight
through.
**Why it's a bug:** trust-boundary / path traversal. A crafted plugin package with
`"id": "../../../../<anything>"` (or an `extension:uninstall` IPC call with such an `id` from a
compromised/buggy renderer or a plugin that can reach the channel) makes `fs.rmSync(..., {recursive:
true, force: true})` **recursively delete an arbitrary directory** outside the extensions folder —
data loss. The same traversal in `install` writes extracted zip contents anywhere on disk, and
`manifest.main` traversal lets the loaded Worker execute an arbitrary `.js` file already on disk.
adm-zip 0.6.0's `extractAllTo` is also historically weak against `../` zip entries (Zip-Slip), and
there is no post-extract containment check.
**Fix idea:** validate `id` against `/^[a-z0-9][a-z0-9._-]*$/` (reject `..`, path separators) in
`validateManifest`; `path.resolve` the target and assert it stays within `baseDir` before any
mkdir/rm/extract; validate `manifest.main` resolves inside the plugin dir; enumerate zip entries and
reject any whose resolved path escapes `pluginDir`.
**Status:** open

### [S8-02] med — api-modules/KernelMessagesModule.ts:100-108 (`forward`)
**What:** `forward` calls `requireCapability(pluginId, 'messages:send')` and then
`requireResourceScope(pluginId, 'messages:send', jid)` **only for the source `jid`** (and only when
the caller supplies it). The `targetJids` array — the chats the message is actually sent to — is
never passed through `requireResourceScope`.
**Why it's a bug:** resource-scope bypass. A plugin whose `messages:send` capability is scoped
(`scope.allow`) to a single chat can forward any message it can name to **arbitrary JIDs** —
`forward(messageId, ['victim@s.whatsapp.net', ...])` — completely defeating the per-chat send
restriction the user configured. `send` / `sendMedia` / `react` correctly scope-check their
destination; `forward` does not.
**Fix idea:** iterate `targetJids` and call `requireResourceScope(pluginId, 'messages:send', t)` for
each before dispatching.
**Status:** open

### [S8-03] med — api-modules/KernelMessagesModule.ts:89-98, 100-108 (`edit`, `forward`)
**What:** Both actions guard the resource scope with `if (jid) { this.requireResourceScope(...) }`.
`jid` is an *optional* caller-supplied field, so a plugin simply omits it and the scope check is
skipped entirely; the underlying `editMessage(sock, messageId, newText, undefined)` /
`forwardMessage(sock, messageId, targetJids, undefined)` still run.
**Why it's a bug:** a scoped plugin can edit (rewrite the text of) or forward **any message by id**,
regardless of which chat it belongs to, by not telling the kernel which chat it is. The capability
check passes (`messages:send` granted) and the scope check is silently bypassed. Scope enforcement
should be mandatory, not opt-in via a field the caller controls.
**Fix idea:** resolve the message's real chat JID server-side (from the message row) and scope-check
against that; never make a security check conditional on an optional request field.
**Status:** open

### [S8-04] med — api-modules/KernelMessagesModule.ts:132-162 (`downloadMedia`), 164-172 (`getReceipts`)
**What:** `downloadMedia` and `getReceipts` check only `requireCapability(pluginId, 'messages:read')`
— no `requireResourceScope`. They take a bare `messageId` and return the media bytes / file path /
full enriched message content, or the read receipts, for **any** message in the database.
**Why it's a bug:** a plugin whose `messages:read` is scoped to chat A can enumerate or guess message
ids and pull media and message content (`message: enriched` includes the decrypted `content` JSON)
and per-recipient receipts from chat B, C, … — cross-chat data exfiltration that the resource scope
was meant to prevent. `getMessages` / `getMessagesAroundId` scope-check by jid; the id-addressed
reads don't.
**Fix idea:** look up the message's chat JID and `requireResourceScope(pluginId, 'messages:read',
chatJid)` before returning anything.
**Status:** open

### [S8-05] med — permissions/PermissionStore.ts:108-134 (`loadFromDisk` / `saveToDisk`)
**What:** Permissions are persisted with a single non-atomic `writeFileSync` of the whole JSON blob.
`loadFromDisk` does `this.storageData = JSON.parse(raw)` and on **any** throw (`catch`) resets to
`{ plugins: {} }` with only a `console.error`.
**Why it's a bug:** fail-open security config. A crash/power-loss during `saveToDisk` (which fires on
every `setCapability` / `setScope`), or any partial/corrupt write, leaves an unparseable file; on the
next launch every user-configured **denial** (`granted:false`) and every resource `scope` is silently
discarded, so every plugin regains all capabilities its manifest declares (which default to
`granted:true` in `hasCapability`). The user is never told their plugin restrictions were wiped.
**Fix idea:** write to a temp file + atomic rename; on parse failure preserve a `.corrupt` copy and
surface an error / keep last-known-good rather than resetting to allow-all.
**Status:** open

### [S8-06] med — api-modules/KernelEventsModule.ts (no unload hook) + plugins/PluginHost.ts:433-462 (`unload`)
**What:** `PluginHost.unload` unregisters contributions, destroys the channel, unregisters from the
plugin registry and drops handlers — but nothing calls `KernelEventsModule` to remove that plugin's
WA-event-bus subscriptions. The handlers registered via `bus.on(event, handler)` in `registerOnBus`
stay attached to the live bus; `pluginSubscriptions` keeps its entry forever (there is no
`onPluginUnloaded` / `removePlugin` method).
**Why it's a bug:** resource leak on every plugin unload / reload / uninstall. The orphaned bus
handler keeps firing for the life of the bus, doing `sanitizeForPlugin(data)` (a full recursive deep
clone of every WhatsApp event payload) and then `this.getChannel?.(pluginId)` → `undefined` → no-op.
Over repeated reloads (dev loop, `extension:reload`) these accumulate, multiplying per-event work.
`reload` re-adds a fresh handler that only de-dups if the same `KernelEventsModule` instance still
holds the stale `pluginSubscriptions` entry (it does), but across a bus rebuild (see [S3-01]) they
are pure garbage. Also `pendingSubscriptions` entries are never removed on `unsubscribe`, so a
sub→unsub before the bus connects still subscribes on connect.
**Fix idea:** add `KernelEventsModule.removePlugin(pluginId)` that `bus.off`s every handler in that
plugin's map and deletes the map + any `pendingSubscriptions` entries; call it from `PluginHost.unload`.
**Status:** open

### [S8-07] med — plugins/PluginHost.ts:445-451 (`unload`, worker plugins)
**What:** For a non-builtin plugin, `unload` does
`metadata.channel.sendToPlugin({ type: 'plugin:deactivate' })` and then, on the very next lines,
`metadata.channel.destroy()` — which for `WorkerPluginChannel` synchronously calls
`this.worker.terminate()`. There is no `await` / ack between the deactivate message and termination.
**Why it's a bug:** the `plugin:deactivate` message is `postMessage`d but the worker thread is
terminated before it can dequeue and process it, so the plugin's `onDeactivate` / cleanup handler
never runs. Any teardown the plugin needs to do — flush `ctx.storage`, close network connections,
persist state, clear external resources — is skipped on every unload / reload / uninstall / app
shutdown (`KernelBootstrapper.dispose` loops `host.unload`). Silent partial-state / lost-write on
teardown.
**Fix idea:** send `plugin:deactivate`, await a response (or a bounded timeout) from the worker, then
`destroy()`. Mirror the builtin path which `await builtin.deactivate()` before destroying.
**Status:** open

### [S8-08] low — permissions/PermissionStore.ts:23-35, 102-106 (no shape validation after load)
**What:** `loadFromDisk` accepts whatever `JSON.parse` returns. If the file parses to a valid JSON
value of the wrong shape (`null`, `[]`, `{}` without a `plugins` key — e.g. hand-edited, or written
by a future/older version), `this.storageData.plugins` is `undefined`.
**Why it's a bug:** `hasCapability` then evaluates `this.storageData.plugins[pluginId]?.capabilities`
→ `TypeError: Cannot read properties of undefined (reading '<pluginId>')`, which propagates as an
`INTERNAL_ERROR` out of `requireCapability` for **every** gated kernel call — all plugin API access
is dead until the file is fixed or deleted. `ensurePluginRecord` / `setCapability` throw the same
way, so the store can't self-heal either.
**Fix idea:** after parse, validate the shape and coerce to `{ plugins: {} }` when
`parsed?.plugins` is not a plain object.
**Status:** open

### [S8-09] low — plugins/PluginHost.ts:291-299 (`ctx.scheduler.setTimeout`) + 292-306
**What:** `scheduler.setTimeout` returns `() => clearInterval(id)` (should be `clearTimeout`), and
`scheduler.setInterval` / `setTimeout` / `onCron` register timers and cron handlers that are **never
tracked against the plugin**. `PluginHost.unload` does not clear them.
**Why it's a bug:** resource leak for builtin plugins (these ctx methods are only wired for the
in-process `registerBuiltin` path). A builtin that schedules a repeating interval and is later
unloaded / reloaded keeps the old interval firing forever against a dead context; `onCron` handlers
stay in `eventHandlers` after unload. `clearInterval` on a timeout handle happens to work in Node but
is wrong and breaks if the return is ever used cross-runtime.
**Fix idea:** track every timer id / cron registration per plugin and clear them in `unload`; use
`clearTimeout` for `setTimeout`.
**Status:** open

### [S8-10] low — ipc/contributionIpc.ts:55-90 (`syncAiTools`) + plugins/PluginHost.ts:453-461
**What:** `syncAiTools` registers a plugin's `ai-tool` contributions into the shared `toolRegistry`
and only skips if `toolRegistry.getTool(name)` already exists — it never *removes* a tool when the
plugin is unloaded. `ContributionRegistry.unregisterAll(pluginId)` drops the contribution entry but
the `toolRegistry` entry (with its `execute` closure capturing `contrib.pluginId`) stays.
**Why it's a bug:** after a plugin is unloaded/uninstalled its AI tools remain callable by the model;
`execute` then hits `host.getPlugin(contrib.pluginId)` → not loaded → returns
`{ text: 'Plugin ... is not loaded' }` on every invocation instead of the tool disappearing. Also a
name collision: if two plugins declare the same tool `name`, the second is silently ignored
(`getTool` short-circuit) with no warning. Stale/again-loaded plugins can't update a tool's schema.
**Fix idea:** on `registry.onChange` diff the `ai-tool` set and `toolRegistry.unregister` names no
longer present; namespace plugin tool names by `pluginId` or reject duplicates loudly.
**Status:** open

## Slice 9 — Kernel storage, channels, ipc, ui

Files read: storage/PrismaPluginStorageRepository.ts, channels/{IPluginChannel,DirectPluginChannel,
WorkerPluginChannel}.ts, ipc/{overlayIpc,panelIpc,contributionIpc}.ts, ui/{OverlayHost,PanelHost,
IOverlayHost,IPanelHost}.ts, + cross-refs: KernelBootstrapper.ts (wiring, lines 100-160),
contributionIpc snapshot/ai-tool sync. channels/{Direct,Worker}PluginChannel + contributionIpc were
also lightly covered in slice 8.

### [S9-01] med — kernel/ipc/panelIpc.ts:17-21,55 + KernelBootstrapper.ts:122
**What:** `registerPanelIpcHandlers(panelHost, router, getBus?.() ?? null)` passes the **resolved**
bus value at bootstrap time. `KernelEventsModule` by contrast is given the `getBus` *function*
(KernelBootstrapper.ts:113) so it always sees the current bus.
**Why it's a bug:** two failure modes. (1) The WhatsApp bus is created lazily on `connect()`; if
bootstrap runs before the first connect, `getBus()` returns `null`, so `waEventBus` is `null`
forever and `eventsSubscribeHandler` permanently returns `{ ok: false }` — panel plugins can never
subscribe to WhatsApp events. (2) Even if a bus exists at bootstrap, `WhatsAppConnectionManager.connect()`
does `currentBus.removeAllListeners(); currentBus = eventBusFactory()` on every reconnect (same
mechanism as [S3-01]). `panelIpc` still holds the old bus, so after any reconnect every panel event
subscription is dead (`.on` was on a discarded bus) and `eventsUnsubscribeHandler`/`panelClosedHandler`
call `.off` on the wrong bus. Silent.
**Fix idea:** pass `getBus` (the accessor) into `registerPanelIpcHandlers` and resolve it inside each
handler; or keep one stable bus instance across reconnects.
**Status:** open

### [S9-02] med — kernel/ipc/panelIpc.ts:49-78 (`eventsSubscribeHandler`)
**What:** The handler resolves `pluginId` from `panelId` purely to check the panel is registered,
then does `waEventBus.on(eventName as any, handler)` for **any** `eventName` string the renderer
passes. There is no `permissions.assertPermission(pluginId, 'events:<eventName>')` (or equivalent)
check — unlike `KernelEventsModule.subscribe`, which gates every WA event subscription on a declared
permission (slice 8).
**Why it's a bug:** trust-boundary / permission bypass. A panel plugin (or a compromised panel
webview) can subscribe to sensitive WhatsApp bus events (`message:received`, `messages.upsert`,
presence, receipts, …) that it never declared in its manifest and that the permission system would
otherwise deny, simply by calling `kernel:panel:events:subscribe` over IPC. Payloads are forwarded
verbatim to the panel via `smartchat:event`.
**Fix idea:** run the same permission check the kernel events module uses before `waEventBus.on`;
reject unknown/undeclared event names.
**Status:** open

### [S9-03] med — kernel/ipc/panelIpc.ts:49-78,94-104 (subscription lifecycle)
**What:** A panel event subscription is only cleaned up by an explicit `kernel:panel:events:unsubscribe`
or `kernel:panel:closed` IPC message from the renderer. There is no `event.sender.once('destroyed', …)`
hook.
**Why it's a bug:** if a panel's webContents/webview is torn down without sending `kernel:panel:closed`
(navigation, crash, renderer bug, window close), the `handler` stays registered on `waEventBus`
forever. `handler` guards with `event.sender.isDestroyed()` so there's no crash, but listeners
accumulate on the bus across panel open/close churn → `MaxListenersExceededWarning`, steadily growing
per-event work, and retained closures over dead `WebContents`. `registerPanelIpcHandlers`' own
teardown clears them, but that only runs on full kernel shutdown.
**Fix idea:** on subscribe, attach `event.sender.once('destroyed', () => cleanup all subs for that
sender)`; track subs by `webContents.id` as well as `panelId`.
**Status:** open

### [S9-04] med — kernel/channels/WorkerPluginChannel.ts:90-99 & DirectPluginChannel.ts:29-49
**What:** `sendRequestToPlugin` creates a pending entry in `pendingRequests` and posts the message,
with **no timeout**. The promise only settles on a matching `KernelResponse`, on `destroy()`, or (for
`DirectPluginChannel`) if the synchronous handler throws.
**Why it's a bug:** a plugin that never replies to a kernel→plugin request (crashed mid-handler,
threw asynchronously after the sync portion, dropped the message, infinite loop) leaves the kernel
call hung forever and the `pendingRequests` entry leaks permanently. Real callers: `contributionIpc`
AI-tool execution (`plugin.channel.sendRequestToPlugin({ type: 'contribution:execute:ai-tool' })` —
`AIToolService` awaits this with no outer timeout), overlay event relays. A single misbehaving plugin
can wedge an AI tool call (and any user turn waiting on it) indefinitely.
**Fix idea:** attach a per-request timeout that rejects with a `PLUGIN_TIMEOUT` error and deletes the
pending entry; document the ceiling.
**Status:** open

### [S9-05] med — kernel/ui/OverlayHost.ts:24-34,55-84,102-114 + kernel/ipc/overlayIpc.ts
**What:** (1) `showModal` returns a promise that is *only* ever resolved by a renderer
`kernel:ui:modal:resolve` IPC; there is no timeout, no reject path, and no cleanup when the main
window is missing/destroyed (it just `console.warn`s and leaves the promise pending + the
`pendingModals` entry leaked). (2) `showOverlay` in `mode: 'handle'` stores a `pendingOverlays` entry
with no resolve/reject; nothing removes it if the renderer never dismisses (window closed, overlay
webview crash). Because `showOverlay` starts with `if (this.hasActiveOverlayForPlugin(pluginId))
throw 'OVERLAY_ALREADY_OPEN'`, a single leaked entry **permanently blocks that plugin from ever
opening another overlay** until app restart.
**Why it's a bug:** plugin API calls (`kernel.ui.showModal` / `showOverlay`) hang forever or become
permanently unavailable on any renderer-side failure, with no error surfaced. `OverlayHost` has no
dispose that rejects outstanding modals/overlays on kernel teardown either.
**Fix idea:** add timeouts + reject-on-window-destroyed for modals; track handle-mode overlays with a
renderer `destroyed`/close signal and evict on it; reject all pending on dispose.
**Status:** open

### [S9-06] med — kernel/ui/PanelHost.ts:11-24,52-58 + KernelBootstrapper.ts:124-148
**What:** `panelHost.deregisterPlugin(pluginId)` is never called in production (grep: only tests).
`syncPanels` runs on every `registry.onChange` and only ever *adds* panels; `registerPanel` dedups by
`(pluginId, contributionId)` and returns the **existing** `panelId` if found.
**Why it's a bug:** (1) On plugin unload, its `PanelDescriptor`s stay in the map. `getPluginId(panelId)`
keeps resolving, so `kernel:panel:api` / `kernel:panel:events:subscribe` still accept calls routed at
an unloaded plugin (downstream `host.getPlugin` returns undefined → confusing errors rather than a
clean "not found"). (2) On plugin *reload* with a changed `panel` path in the manifest, `registerPanel`
returns the stale `panelId` bound to the **old `panelPath`**, so the renderer keeps loading the old
panel entry point. (3) Slow map growth across reload churn.
**Fix idea:** call `panelHost.deregisterPlugin` from the plugin unload path (PluginHost/loader), and
have `syncPanels` reconcile removals; or key `registerPanel` on `panelPath` too so a changed path
re-registers.
**Status:** open

### [S9-07] low — kernel/ipc/overlayIpc.ts:5-31 + panelIpc.ts (sender not correlated)
**What:** `kernel:ui:modal:resolve`, `kernel:ui:overlay:submit`/`event`/`dismiss`, and
`kernel:panel:events:*` handlers act on the `modalId` / `overlayId` / `panelId` in the payload
without checking the message came from the webContents that owns that modal/overlay/panel.
**Why it's a bug:** any frame that can reach these IPC channels (a plugin panel/overlay webview, a
compromised renderer) can resolve or submit data into *another* plugin's pending modal/overlay by
guessing/observing its id (`randomUUID`, but ids are handed to renderers and logged). The receiving
plugin treats the injected value as trusted user input. Blast radius limited by the ids being
UUIDs and the renderer being semi-trusted, but the ownership check is absent.
**Fix idea:** record the owning `webContents.id` when a modal/overlay is shown and verify
`event.sender.id` matches on resolve/submit.
**Status:** open

### [S9-08] low — kernel/ipc/contributionIpc.ts:55-90,163-193
**What:** (1) `syncAiTools` registers an `ai-tool` for every contribution but nothing ever
*unregisters* tools when a plugin unloads/reloads — `toolRegistry.getTool(name)` stays populated, so
a stale tool remains callable and just returns `"Plugin <id> is not loaded"` to the model. A reload
that renames/removes the tool leaves the old one. (2) The teardown calls
`ipcMain.removeHandler('extension:getLog')` but the handler was registered as `'extension:get-log'`
(line 172) — so on kernel teardown that handler is never removed (double-register throws on a
subsequent bootstrap).
**Why it's a bug:** stale AI tools pollute the model's tool list and waste turns; the channel-name
typo makes kernel teardown/re-init leak an IPC handler.
**Fix idea:** track registered tool names per plugin and remove on unload; fix the string to
`'extension:get-log'`.
**Status:** open

### [S9-09] low — kernel/ui/PanelHost.ts:35-45 (`getPanel` fallback)
**What:** `getPanel(panelId)` first tries `panels.get(panelId)`, then **falls back to returning the
first descriptor whose `contributionId === panelId`**. `getPluginId` is built on this.
**Why it's a bug:** if two plugins register panels with the same `contributionId` (e.g. both use
`"settings"` or `"main"`), a lookup by that bare contributionId resolves to whichever plugin's panel
happens to iterate first in the `Map`, so `kernel:panel:api` can route a panel request to the wrong
plugin. The fallback exists so callers can pass a contributionId instead of a UUID, but it makes the
identifier non-unique.
**Fix idea:** drop the contributionId fallback (require the real `panelId`), or scope it by plugin.
**Status:** open

### [S9-10] low — kernel/storage/PrismaPluginStorageRepository.ts:29-45
**What:** `delete` wraps the Prisma call in `try { … } catch {}` with a comment "Ignore if not
found" — but it swallows **every** error (DB locked, disk I/O, connection lost), not just P2025.
`set`/`clear` have no value-size or key-count limits.
**Why it's a bug:** a failed `delete` (transient lock during heavy sync) is reported to the plugin as
success, so the plugin believes a key was removed when it still exists. Separately, a plugin can
write arbitrarily large values / unbounded keys into the shared `extensionKV` table with no quota.
**Fix idea:** only swallow the not-found error code; add a max value size and per-plugin key cap.
**Status:** open

## Slice 10 — App IPC & auth

Files read: auth.ts, ipcHandlers.ts, ipc/{types,message.types,chat.types,reaction.types}.ts,
services/auth/{AuthSettingsService,AuthStateRepository,IAuthSettingsService,IAuthStateRepository}.ts,
ServiceContainer.ts, + cross-refs: src/preload/index.ts, index.ts (protocol/window/handler wiring),
services/whatsapp/WhatsAppConnectionManager.ts (connect flow), services/ai/IToolRegistry.ts,
services/apiServer/controllers/ToolsController.ts.

### [S10-01] crit — services/auth/AuthStateRepository.ts:14-24 (`getValue`) → WhatsAppConnectionManager.ts:69-80
**What:** `getValue` wraps `prisma.authState.findUnique` in `try/catch` that **returns `null` on any
error** (DB locked, I/O, adapter hiccup). `AuthSettingsService.hasCreds()` is just
`getValue('creds') !== null`, so a transient read failure makes `hasCreds()` return `false`.
`WhatsAppConnectionManager.connect()` then treats the user as logged-out: sets `isFreshLogin = true`,
clears `history_sync_completed`, and — if `chatRepository.countChats() > 0` — calls
`this.dataWipeService.wipeAllData()`.
**Why it's a bug:** `connect()` runs on every launch and on every reconnect (settings change,
re-login, worker restart). SQLite lock contention is expected here — WAL + `busy_timeout = 5000`,
and the WhatsApp worker writes the same DB file concurrently during sync. A single `creds` read that
times out or errors while `countChats()` happens to succeed (>0) triggers a **full wipe of a
logged-in user's local database** (chats, messages, media rows, contacts) — permanent local data
loss — with only a `console.error` from the swallowed catch. The swallow converts a retryable error
into a destructive false negative.
**Fix idea:** `getValue` must distinguish "row absent" (return null) from "query failed" (throw or
return a sentinel); `hasCreds()` / the wipe path in `connect()` must fail closed (skip wipe, retry)
on error, never treat an errored read as "no creds".
**Status:** open

### [S10-02] high — auth.ts:223-257 (`baseKeyStore.set`)
**What:** All Signal key mutations (pre-keys, sessions, sender-keys, app-state-sync keys) are
aggregated into one `prisma.$transaction(ops)` whose failure is caught and reduced to
`console.error('[AuthState] Batch keystore transaction failed:', err)` — the method still resolves
normally.
**Why it's a bug:** Baileys calls `keys.set(...)` after it has already used / advertised those keys
(ratchet advanced, pre-keys marked uploaded to the server). If the transaction fails (lock
contention with the worker, disk error) the new key material is silently lost while Baileys and the
server believe it was persisted. After the next restart the local ratchet state is stale: affected
conversations show "Waiting for this message" / undecryptable messages, and pre-key reuse/desync can
require a full re-link to recover. No error surfaces to Baileys or the user.
**Fix idea:** propagate the failure to the caller (let Baileys retry / abort), or retry the
transaction with backoff; at minimum emit a hard error that forces a reconnect rather than
continuing as if the keys were stored.
**Status:** open

### [S10-03] med — auth.ts:179-205 (`readData`) + 207-208 (`creds` bootstrap)
**What:** `readData` catches every error and returns `null`. `const creds = (await readData("creds"))
|| initAuthCreds()` — so a failed read of the `creds` row yields a **brand-new credential set**.
**Why it's a bug:** twin of [S10-01] at the Baileys layer. A transient DB error while loading
`creds` at startup makes the socket start as an unregistered client: it generates fresh keys, shows
a QR, and the first `saveCreds()` **overwrites the real stored creds** with the new identity —
the existing WhatsApp link is destroyed by a read hiccup, not by an actual logout. Likewise a
transient error in the keystore `get` path returns `null` for real keys, causing spurious
decryption failures for that session.
**Fix idea:** on read error, throw so startup aborts/retries instead of silently minting a new
identity; only fall back to `initAuthCreds()` when the row is genuinely absent.
**Status:** open

### [S10-04] med — ipcHandlers.ts:152-165 (`save-temp-file`) & 167-178 (`download-url-to-temp`)
**What:** Both handlers do `const filePath = join(tempDir, fileName)` with `fileName` taken verbatim
from the renderer argument — no `path.basename`, no containment check.
**Why it's a bug:** a `fileName` of `..\\..\\..\\Users\\me\\AppData\\Roaming\\smartchat\\dev.db` (or
any traversal / absolute path — `join` lets `..` segments escape, and a rooted path replaces the
base) causes `fs.writeFileSync` to write attacker-controlled bytes anywhere the process can write:
overwrite the SQLite DB, the plugin-permissions JSON, auto-start scripts, etc. The renderer is the
trust boundary here (rendered message content, AI output, plugin-influenced UI can reach these
channels), and `download-url-to-temp` additionally lets the page pick both the bytes (any URL) and
the destination.
**Fix idea:** `const safe = path.basename(fileName)` and verify `path.resolve(tempDir, safe)` is
still inside `tempDir` before writing; reject otherwise.
**Status:** open

### [S10-05] med — ipcHandlers.ts:312-321 (`execute-tool`) + services/ai/IToolRegistry.ts:17
**What:** `execute-tool` looks up the tool and calls `tool.execute(args, ctx)` with no check of
`tool.requiresPermission`. Grep shows `requiresPermission` is **only ever read to display it**
(`get-ai-tools`, `ToolsController`) — there is no enforcement anywhere in the backend.
**Why it's a bug:** any code running in the renderer can invoke `window.api.executeTool('<name>',
args)` directly and run a permission-gated tool (send messages, mutate chats, filesystem-touching
tools) without the user's per-call approval — the approval gate exists only in renderer UI and is
trivially bypassed by injected/rendered content or a buggy component. The flag gives a false
impression that the backend enforces it.
**Fix idea:** enforce `requiresPermission` in the `execute-tool` handler (and the apiServer path) —
prompt / check a granted-permission store in the main process before `tool.execute`.
**Status:** open

### [S10-06] med — ipcHandlers.ts:230-235 (`logout`) + all handlers (no sender validation)
**What:** `logout` runs `sock.logout()` then `services.dataWipeService.wipeAllData()` on receipt of
a bare IPC message, with no confirmation token and no `event.senderFrame` / URL check. No handler in
`ipcHandlers.ts` validates the sender frame.
**Why it's a bug:** a single `ipcRenderer.invoke('logout')` from anywhere with bridge access
destroys all local data and unlinks the device. Combined with [S10-07] (generic `electronAPI`
exposure) and any sub-frame / webview / injected script in the renderer, this is a one-call
destructive action across the trust boundary. Electron's own guidance is to validate
`event.senderFrame` on privileged channels.
**Fix idea:** gate destructive channels (`logout`, `clear-vectors`, wipe-adjacent) behind an
explicit main-process confirmation dialog and/or validate `event.senderFrame.url` against the app
origin on every handler.
**Status:** open

### [S10-07] low — src/preload/index.ts:421-427
**What:** The preload exposes both the curated `api` object **and** `@electron-toolkit/preload`'s
`electronAPI` (`contextBridge.exposeInMainWorld('electron', electronAPI)`), which provides a generic
`ipcRenderer` with `invoke`/`send`/`on`/`removeAllListeners` for arbitrary channel names.
**Why it's a bug:** the curated `api` whitelist is defeated — renderer code can reach every
`ipcMain.handle` channel in the app (kernel plugin channels, `execute-tool`, `logout`, overlay/panel
IPC) regardless of what `api` chooses to surface. It also lets renderer code subscribe to / spoof
internal event channels. Widens the blast radius of every other trust-boundary finding.
**Fix idea:** don't expose the generic `electronAPI` in the main renderer preload; expose only the
explicit typed methods the renderer needs.
**Status:** open

### [S10-08] low — auth.ts:194-205 (`writeData`) + 264-266 (`saveCreds`)
**What:** `writeData` catches upsert errors and only `console.error`s; `saveCreds` returns
`writeData(creds, "creds")`, which resolves successfully even when the write failed.
**Why it's a bug:** Baileys awaits `saveCreds()` after `creds.update` and proceeds as if creds are
durable. A failed write (lock, disk full) is invisible: on next launch the pairing / registration
step or key-id counters are stale, and the client may need re-linking. Swallowed-error →
"told the caller ok".
**Fix idea:** let `writeData` reject and `saveCreds` propagate; Baileys will retry on its schedule.
**Status:** open

### [S10-09] low — ipcHandlers.ts:250-254 (`set-sync-full-history`)
**What:** Handler calls `waConnectionManager.connect()` as a floating promise (no `await`, no
`.catch`) then immediately `return true`. Duplicate of [S3-04]; recorded here because the call site
is in this slice's scope.
**Why it's a bug:** a rejection in `connect()` (see [S10-01] paths, `wipeAllData`,
`getHistorySyncCompleted`) is an unhandled rejection; the renderer is told the setting change
succeeded and a reconnect is underway while the connection may be left half-torn-down (old bus
already `removeAllListeners()`'d).
**Fix idea:** `await` + try/catch, return real success/failure to the renderer.
**Status:** open

### [S10-10] low — auth.ts:124-173 (`initVectorDb`)
**What:** On a detected dimension mismatch the self-heal does
`DROP TABLE IF EXISTS vec_messages` and recreates it; the whole function body is also wrapped in a
`try/catch` that only `console.error`s.
**Why it's a bug:** the drop silently discards every stored embedding (the `vec_messages` virtual
table) with no signal to the user or to `VectorSyncService`; recovery depends on a later
`vecCount < prismaCount` check happening and `MessageVector` still holding the source rows. If the
outer catch fires earlier, vector search is silently degraded/broken for the session with no
surfaced error.
**Fix idea:** log the drop as a warning the UI can show, and explicitly trigger a full re-sync after
recreation; surface init failure rather than swallowing it.
**Status:** open

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
