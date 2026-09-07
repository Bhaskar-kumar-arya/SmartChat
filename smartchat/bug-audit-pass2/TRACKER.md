# Backend Bug Audit — Pass 2 — Tracker

Single source of truth for this audit. Read [`README.md`](./README.md) first
(protocol + full checklist + slice map). Independent of `../bug-audit/` — no
need to read that folder.

Statuses: `TODO` · `IN PROGRESS` · `DONE (<n> findings)` · `BLOCKED`

## Status

| # | Slice | Status | Last touched | Notes |
|---|-------|--------|--------------|-------|
| 1 | WhatsApp worker & socket | DONE (5 findings) | 2026-09-07 | 0 crit, 0 high, 2 med, 3 low |
| 2 | Message pipeline | IN PROGRESS | 2026-09-07 | |
| 3 | WhatsApp service & subscribers | TODO | — | |
| 4 | Chats & sync | TODO | — | |
| 5 | Contacts | TODO | — | |
| 6 | AI (providers, mentions, citations, prompts) | TODO | — | |
| 7 | Kernel API modules & router | TODO | — | |
| 8 | Kernel plugins, contributions, permissions | TODO | — | |
| 9 | Kernel storage, channels, ipc, ui | TODO | — | |
| 10 | App IPC & auth | TODO | — | |
| 11 | apiServer, search, notification, calls, audio | TODO | — | |
| 12 | SDK, tools, data wipe, domain, db, protocol | TODO | — | |
| 13 | Cross-cutting pass | TODO | — | do only after 1–12 |

## Summary counts

| Severity | Count |
|----------|-------|
| crit | 0 |
| high | 0 |
| med  | 2 |
| low  | 3 |

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

Not started. When it starts: commit directly to `main`, test-first where
feasible, manually verify in the running app for IPC/socket/lifecycle bugs,
record a test/typecheck baseline first. See `FIX_PLAN.md`.
