# Bug Audit Tracker

Single source of truth. Read [`README.md`](./README.md) for the session protocol
and the bug-class checklist. Update the status table and append findings here.

Statuses: `TODO` · `IN PROGRESS` · `DONE (<n> findings)` · `BLOCKED`

## Status

| # | Slice | Status | Last touched | Notes |
|---|-------|--------|--------------|-------|
| 1 | WhatsApp worker & socket | DONE (8 findings) | 2026-09-06 | 0 crit / 0 high / 5 med / 3 low |
| 2 | Message pipeline | TODO | — | largest slice (~55 files); may need 2 sessions |
| 3 | WhatsApp service & subscribers | TODO | — | recent OTP relay + queue-subscriptions fix |
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
| med  | 5 |
| low  | 3 |

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

_none yet_

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
