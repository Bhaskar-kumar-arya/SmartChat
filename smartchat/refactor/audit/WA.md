# Audit — slice WA (WhatsApp connection layer)

Scope read in full: `src/main/services/whatsapp/**`, `src/main/workers/**`, `src/main/historySync.ts`
(plus call sites in ServiceContainer, index.ts, ipcHandlers, preload, MessageSender/Action/IdentityResolver).
Verified against installed `@whiskeysockets/baileys@7.0.0-rc13` (the version package-lock.json pins) and with two
throwaway scripts in the scratchpad (Baileys patch-target check; sqlite-vec wipe repro).

Architecture note: production runs Baileys only inside the worker (`whatsapp.worker.ts`). The main-process
`HistorySyncManager`, `WAEventWiringService`, and `WACatchUpManager` are built in `ServiceContainer.ts:331-333`
but never wired (`.wire(` has no caller). They are dead code, and so are their tests.

## 1. Bugs (confirmed)

- [B-WA-01] **high** `workers/bridge/WAWorkerBridge.ts:124-133`: `bridge.user` is never set.
  The bridge reads `update.creds.me` from `connection.update`, but Baileys' `ConnectionState` has no `creds` field
  (`Types/State.d.ts:14-40`), and the worker publishes nothing else that carries it. `currentUser` therefore stays `null`
  for the whole life of the app. Main-process callers that rely on `sock.user` quietly take their fallbacks:
  `MessageSenderService.ts:63-66` sends quoted replies to your own messages with no `participant`, so recipients cannot
  resolve the quote in groups. `MessageActionService.ts:275-285` also loses its fallback, `ContactNameResolver.ts:87`
  shows "Me", and `ContactService.getMeJids` relies only on the DB. Fix: the worker publishes `wa-me {id,name,lid}` from
  `sock.user` on `open` and on `creds.update`, and the bridge stores it. Add a bridge test that feeds a real
  connection.update shape.

- [B-WA-02] **high** `workers/whatsapp/socket/workerConnectionManager.ts:216-234`: the worker wipe always fails once
  `vec_messages` exists. It deletes every `sqlite_master` table, which includes the `vec0` virtual table that the main
  process creates (`auth.ts:133`). The worker never loads sqlite-vec, so `DELETE FROM "vec_messages"` throws `no such
  module: vec0` and the `$transaction` rolls back, AuthState included. I reproduced this with better-sqlite3 and
  sqlite-vec. Failure: the user unlinks the device from the phone → 401 → `wipeAndReconnect` (`:190`) → the wipe fails
  and is only logged → `connect()` finds the old creds → 401 again. This loops with no backoff and never shows a QR.
  Only a user-initiated IPC `logout` escapes, because the main `DataWipeService` has the extension loaded. Fix: skip
  virtual tables and their `vec_*` shadow tables in the worker (`sql NOT LIKE 'CREATE VIRTUAL%'`), or ask main to wipe.
  At minimum, always delete AuthState, even when the full wipe fails.

- [B-WA-03] **high** `services/whatsapp/BaileysPatcher.ts:60-68,136-179` (called unguarded at `index.ts:14`): the
  patcher is broken on the pinned Baileys version.
  (a) In rc13 the `tried remove` throw no longer exists, so patch 2 records a failure and `reportFailures` throws in any
  unpackaged run. The main process then dies while loading modules at startup, so dev is broken. This is the S13-06
  "fix" misfiring.
  (b) The patch-4 regex still matches `Socket/chats.js:548`, so it replaces upstream's newer `profilePictureUrl`. That
  code has `isSelf` and `profilePicPrivacyToken` guards; upstream notes that sending a tctoken for your own JID "causes
  the server to never respond".
  (c) In packaged builds the asar is read-only, so no patch applies and `app-state.sync` is never emitted. The whole
  `AppStateSyncParser` pipeline (phone-side mute, pin, star, and favourite-sticker sync) is dead in production.
  Fix: move the patches to `patch-package` at build time, version-gate each one, and drop patches 2 and 4 for rc13.

- [B-WA-04] **high** `workers/whatsapp/routing/workerCommandRouter.ts:26-47` + `WAWorkerBridge.ts:208-217`: a failed
  init is silently dropped. `init` is posted with `correlationId:'init-call'` and never registered in `pendingReplies`,
  so a `reply_error` for it is ignored. If `bootstrapPrismaAndRepos`, `hasCreds`, `getHistorySyncCompleted`, or the
  creds read fails on a transient SQLITE_BUSY at startup, the worker stays alive with `sock=null`. Nothing retries,
  nothing tells the UI, and the supervisor never fires because the thread did not exit. `useLocalPrismaAuthState.ts:226-230`
  deliberately throws "so connect()'s retry path can re-attempt", but the first connect has no retry path. Fix: route
  init through `sendCommand` (with a longer timeout) and treat a rejection as worker death (`stop()` +
  `unexpectedExitHandler`), or have the worker call `scheduleReconnect` when the initial connect fails.

- [B-WA-05] **med** `workers/whatsapp/socket/useLocalPrismaAuthState.ts:249-260`: `saveCreds` still swallows write
  errors. P2-S10-03 is marked fixed with the claim that "the worker-copy … was already hardened", but that is false.
  Only `keys.set` was hardened, and `writeData` (which backs `saveCreds`) still catches and logs. The worker copy is the
  path production actually uses. If the post-pairing `creds` write fails, Baileys carries on and the next launch shows
  a QR or stale creds. Fix: add retry-then-throw as in `set` (`:319-340`) and a test.

- [B-WA-06] **med** `workers/whatsapp/services/WorkerHistorySyncManager.ts:95,186-196`: completion can be deferred
  forever. ON_DEMAND chunks increment `activeChunks`, but their `finally` skips the `pendingFinish` flush
  (`!isOnDemand && …`). If the 180 s inactivity timer or a Skip calls `finishSync` while an on-demand page is persisting,
  it returns `'deferred'` and sets `pendingFinish=true`. The on-demand chunk then finishes without flushing and no timer
  is re-armed. Result: `history_sync_completed` is never saved, `wa-sync-complete` never fires, and main's
  `EmbeddingSyncSubscriber` keeps embedding paused. Fix: don't count on-demand chunks in `activeChunks`, or flush
  `pendingFinish` in `finally` whatever the chunk type.

- [B-WA-07] **med** `services/whatsapp/secret/MessageReactionStrategy.ts:325-337`: encrypted reactions are attributed to
  the wrong person. `reaction.key.fromMe` is set from the *target* message's `fromMe` (`SecretMessageService.ts:65`).
  When someone else sends an encReactionMessage on *my* message, `fromMe=true`, so `MessageIdentityResolver.resolveReactorJid`
  (`:52`) and `MessageService.resolveReactorIdForReaction` resolve the reactor as me. That also overwrites my own
  reaction row, which is keyed `(targetId, reactorId)`. The reverse case (my reaction on someone else's message) is
  attributed to `senderJid`. Tests only cover `fromMe:false`. Fix: set the reaction key's `fromMe` from the envelope
  `msg.key.fromMe` (add it to `SecretMessageContext`).

- [B-WA-08] **med** `workers/whatsapp/socket/connectSocket.ts:43` + `workerConnectionManager.ts:151`: the group
  metadata cache is never filled. `groupCache` is created fresh on every connect, and nothing calls `.set`
  (grep: no writer), so `cachedGroupMetadata` always misses. Baileys then sends a `groupMetadata` IQ on every group send
  and retry, which is the rate-limit/ban pattern the option is meant to prevent. Fix: hoist the cache to a field and
  fill it from `groupFetchAllParticipating` (finishSync), `groups.update`, and `group-participants.update`.

- [B-WA-09] **med** `workers/bridge/WAWorkerBridge.ts:220-227`, `workers/whatsapp/socket/workerConnectionManager.ts:253-271`:
  the worker is only ever killed hard. `stop()` calls `worker.terminate()` directly, on every reconnect
  (`WhatsAppConnectionManager.ts:240-246`) and at quit. `WorkerConnectionManager.shutdown()` has no caller, and the
  command protocol has no `shutdown` message. So there is no `sock.end`, no flush of a `keys.set` or `saveCreds` write
  in flight, and no `prisma.$disconnect`. Killing mid-`keys.set` is exactly the key-loss case S10-02 hardened against.
  Fix: add a `shutdown` command that calls `connectionManager.shutdown()` and waits for Prisma, await the reply with a
  timeout of about 3 s, then terminate.

- [B-WA-10] **med** `workers/embedding/embedding.worker.ts:92-100,116`: two lifecycle races.
  (a) If `setModel` arrives while a `loadPipeline` is in flight, it nulls `pipeline`/`initPromise`. The old load then
  resolves and writes the module-level `pipeline` and `currentModelName` back to the *old* model, so the wrong model is
  used silently (and possibly with a different vector dimension).
  (b) A load failure triggered by `embed` leaves the rejected `initPromise` cached, because the reset happens only for
  `type==='init'`. Every later embed then fails until an init or setModel.
  Fix: use a load token or generation check before assigning, and reset `initPromise` on any load failure.

- [B-WA-11] **low** `workers/whatsapp/socket/workerConnectionManager.ts:146-149` + `workerConnectionHandler.ts:175-177`:
  a sync interrupted by a restart never completes on its own. `historySyncManager.clear()` runs right before
  `isInProgress` is read, so `isInitialSyncInProgress` is always false (dead term). More importantly, on a restart after
  a crash mid-sync the handler publishes `wa-connected{isCatchup:false}`, and main's `EmbeddingSyncSubscriber` pauses
  embeddings. The inactivity timer is armed only inside `handleSyncChunk`, so if WhatsApp does not resend chunks,
  nothing ever calls `finishSync` until the user presses Skip. Fix: arm the inactivity timer on `open` when sync is
  incomplete.

- [B-WA-12] **low** `workers/bridge/WAWorkerBridge.ts:196`: the renderer never hears `wa-disconnected`. Preload has no
  listener for it (`src/preload/index.ts`), so the UI half of the S13-04 supervision fix never arrives. After
  `MAX_WORKER_RESTARTS` the UI still looks connected. Fix: expose `onWaDisconnected` and handle it in `App.tsx`.

- [B-WA-13] **low** P2-S1-04 fix is incomplete: `WAWorkerBridge.skipSync` (`:290-292`) discards the `{status}` reply,
  and `WhatsAppConnectionManager.skipSync` (`:350-356`) is fire-and-forget. The `'deferred'` status is computed but
  nobody receives it. Fix: return the status through to the IPC and the renderer.

- [B-WA-14] **low** `services/whatsapp/WhatsAppConnectionManager.ts:221-312`: `connect()` has no mutex. The supervised
  timer (`:196-202`), IPC `set-sync-full-history` (`ipcHandlers.ts:~361`), and startup can overlap. Both calls then
  create a bus. The first bus's subscribers are overwritten without `dispose()`, `busCreatedCallback` fires twice, and
  the second `start()` just logs "already running". Fix: serialise with an in-flight promise.

- [B-WA-15] **low** `workers/bridge/WAWorkerBridge.ts:278-280` vs `workerCommandRouter.ts:97`: `group_fetch_all` replies
  `{groups}`, but the bridge is typed to return `Record<jid,GroupMetadata>`. Its only caller is the dead main
  `HistorySyncManager.ts:187`, which would hydrate a single bogus "groups" entry. This is latent: fix the contract or
  delete the method.

- [B-WA-16] **low** `workers/whatsapp/services/WorkerHistorySyncManager.ts:97-112`: some on-demand outcomes are never
  announced. If `handleHistorySync` throws, the outer `catch` logs and `wa-history-appended` is never sent, so the
  renderer waits its 40 s timeout. The payload also has no `jid` or `requestId`, so the renderer cannot tell an empty
  page from a page for a different JID. Fix: always publish `{jid, requestId?, messageCount, error?}`.

SUSPECT (not fully confirmed):
- `workers/whatsapp/events/WorkerEventBusAdapter.ts:53-55` publishes to main *before* awaiting the worker's own
  handlers (`PersistenceSubscriber` incrementUnread/revoke/edit writes). Main then broadcasts `new-message`/`message-deleted`
  ahead of the DB writes. That contradicts the ordering promise in `WAEventBus.ts:7-9`, so renderer re-queries such as
  `useChats` `getChat` can read stale unread counts.
- `WAEventHandler.ts:75-86`: once history sync is complete, `type:'append'` upserts go through `processRealtimeMessage`
  and emit `message:incoming`. Nothing carries the upsert type, so `NotificationSubscriber` (whose header claims it
  "skips append") can notify for messages that are not `notify`.
- On-demand anchor (`MessageQueryRepository.findOldestMessageKey`) may pick a synthetic `call_<id>` row
  (`WAEventHandler.ts:408`) or a chat stored under PN while WhatsApp keys the thread by LID. WhatsApp may then return an
  empty page, and `useMessages.ts:171-180` sets `hasMore=false` permanently.
- `ReceiptService.ts:137-143`: group READ/DELIVERED counts are receipts keyed by raw `userJid`. If one member's receipts
  arrive under both LID and PN, they count twice and a message can be marked READ-by-all too early.
- `WorkerMediaService.ts:238,335` / `WorkerFavoriteStickerService.ts:176`: `writeFileSync` writes straight to the final
  path. A crash mid-write leaves a truncated file, and `existsSync` then skips the re-download forever.
- `workerUtils.sanitizeForPostMessage` turns `bigint` into `number`, while `WAEventTypes` declares `bigint`
  (`IncomingMessageEvent.timestamp`). Main-side or plugin consumers doing bigint arithmetic would throw a mixed-type
  TypeError.

## 2. Code quality / design issues (ranked)

1. **Dead main-process twins of the worker code.** `HistorySyncManager.ts` (246 lines, 90% copy of
   `WorkerHistorySyncManager.ts`), `WAEventWiringService.ts` (135, 90% copy of `workerEventDispatcher.ts`), and
   `WACatchUpManager.ts` (94, re-implemented in `workerConnectionHandler.ts:46-92`) are all constructed in
   `ServiceContainer.ts:331-333` and never used. Their tests (`HistorySyncManager.test.ts`, `WAEventWiringService.test.ts`,
   `WACatchUpManager.test.ts`) keep them looking alive. The copies have already drifted apart (the worker gained the
   ON_DEMAND path, the main copy didn't).
2. **Duplicated login/wipe policy across the process boundary.** `WhatsAppConnectionManager.connect` (`:255-299`) and
   `WorkerConnectionManager.connect` (`:105-149`) both run hasCreds, clearHistorySyncCompleted, orphan-wipe, and
   fresh-login logic. `WorkerConnectionManager.wipeAllData` re-implements `DataWipeService.wipeTables`, and the two have
   diverged (vec handling → B-WA-02).
3. **The worker↔main contract is stringly typed.** `WorkerEventMessage.domain_event.event: string`
   (`whatsappWorker.types.ts:65`). The bridge keeps hard-coded allow-lists (`WAWorkerBridge.ts:135-164`) for window
   forwarding and `sock` injection. Direct `eventPublisher.publish('wa-…')` calls (history manager, connection handler)
   bypass `WAEventMap`, and `wa-connected` carries `{isCatchup}` while the map says `void`. `wa-history-appended` and
   `wa-session-replaced` are not in `WAEventMap` at all.
4. **Magic sync-type numbers.** `SYNC_TYPE_GROUP_HYDRATION = 6` (`constants.ts:14`) collides with Baileys `ON_DEMAND = 6`,
   and literal `syncType: 6` appears at `workerConnectionHandler.ts:78,168` and `WACatchUpManager.ts:88`. The
   "progress 100 + wa-sync-complete" pair is copy-pasted 3×.
5. **Leftover `syncFullHistory` plumbing** now that `getSyncFullHistory()` is hard-wired to false (a7c24f4): bridge
   `start(syncFullHistory, shouldSyncHistory)`, where `shouldSyncHistory` is never read by the worker
   (`workerCommandRouter.ts:27`); progress maths for FULL; and `set-sync-full-history` IPC, which still does a full
   worker restart (`ipcHandlers.ts:~351-365`) although nothing in the renderer calls it. CONTRACT-CHANGE to remove it.
6. **`workerCommandRouter.ts` (252 lines):** 12 near-identical `case` blocks with repeated `parentPort.postMessage({type:'reply'…})`
   code. It could be table-driven (`handlers: Record<type, (payload)=>Promise<result>>`). The reply goes through
   `parentPort` directly, which makes it hard to test.
7. **God-ish files:** `WAEventHandler.ts` 454 lines (parsing, mute normalisation duplicated between `handleChatsUpdate`
   and `handleChatsUpsert` at :319-329/:341-351, call-message synthesis), `WorkerMediaService.ts` 357, `UIBroadcastSubscriber.ts`
   318 (edit/decrypt content-merge logic belongs in the message domain, not the IPC layer), `WAWorkerBridge.ts` 313.
8. **Duplicate helpers:** `sanitizeIPCPayload` (`UIBroadcastSubscriber.ts:279`) vs `sanitizeForPostMessage`
   (`workerUtils.ts:116`). The `setMaxListeners` block appears in both `connectSocket.ts:58-70` and
   `WAEventWiringService.ts:22-34`. `WorkerFavoriteStickerService` and `WorkerMediaService` duplicate
   `services/messages/FavoriteStickerService`/`MediaService`. "Resolve me from `sock.user` then fall back to the DB"
   is repeated in `MessageIdentityResolver.ts:27,54,92`, `MessageActionService.ts:275`, and `ReactionMessageProcessor.ts:23`.
9. **Concrete-type coupling:** `IWorkerBootstrap` exposes concrete classes (`AuthSettingsService`, `ContactService`, …).
   `WorkerCommandRouter` types repos as `any` (`:20`), and `WASocket` in `types/socket.types.ts` is the bridge shape
   while `@whiskeysockets/baileys` `WASocket` is the real one, even though both are named `WASocket`.
   `HistorySyncManager` (main) imports `electron`.
10. **Casts:** 140 `as X` casts in the slice, 15 of them `as unknown as`, 6 `any`, 5 ts-ignore/eslint-disable. They
    cluster in the event plumbing (`WAEventHandler`, `AppStateSyncParser`, `WAWorkerBridge`), where typed Baileys
    payloads are available.
11. **Needless per-batch DB read:** `WAEventHandler.handleMessagesUpsert` hits the DB for `getHistorySyncCompleted()`
    on every upsert batch (`:71-73`). This should be cached state in the history manager.
12. **Unused build:** `useLocalPrismaAuthState.set` builds the op list once just to test `length` (`:311`), creating
    PrismaPromises it never runs.

## 3. Test quality

Source with **no** tests: `WAEventHandler.ts` (454 lines; only exercised through the dead `WAEventWiringService`
test), `WAEventBus.ts`, `workers/whatsapp/events/WorkerEventBusAdapter.ts`, `workerEventDispatcher.ts`, `whatsapp.worker.ts`,
`bootstrapWorkerRepositories.ts`, `utils/workerUtils.ts` (`sanitizeForPostMessage`/`restoreBuffers` are the wire
contract), `embedding/embedding.worker.ts`, `BaileysPatcher.ts`, `secret/MessageEditStrategy.ts` (only indirectly via
`tests/services/SecretMessageService.test.ts`), `historySync.ts` (always mocked), and the `fetch_message_history`
router case.

Weak or misleading tests:
- `workers/whatsapp/services/WorkerHistorySyncManager.test.ts`: no ON_DEMAND case at all, although the three recent
  commits (c19929c, 9647a83) changed exactly that path. Nothing asserts that `wa-history-appended` is published or that
  on-demand chunks don't touch the finish machinery (B-WA-06).
- `workers/whatsapp/socket/workerConnectionManager.test.ts:74` ("wipes every table inside a single $transaction"):
  Prisma is mocked, so it passes while the real wipe always fails on `vec0` (B-WA-02). It needs an integration test on
  a real SQLite file with sqlite-vec present.
- `workers/bridge/WAWorkerBridge.test.ts`: no test for `connection.update` → `user` (B-WA-01 would have shown up),
  no init-failure test (B-WA-04), and it waits with `setTimeout(r,0)` ticks (`:84,:173`).
- `whatsapp/secret/MessageReactionStrategy.test.ts`: every fixture uses `fromMe:false` (`:28,44,50,73,94`), so the
  attribution bug is invisible (B-WA-07). It also lives in `tests/whatsapp/` while its peers live in
  `tests/services/whatsapp/`, which is inconsistent.
- `workers/whatsapp/routing/workerCommandRouter.test.ts`: covers only `skip_sync`. None of the other 11 commands or the
  error/`reply_error` path is tested.
- `services/whatsapp/HistorySyncManager.test.ts`, `WAEventWiringService.test.ts`, `WACatchUpManager.test.ts` test dead
  code. Delete them together with the sources.
- `workers/whatsapp/socket/useLocalPrismaAuthState.test.ts` hardens `set` and the `creds` read but has no `saveCreds`
  failure case (B-WA-05).
- Subscriber tests are mostly "handler calls service with X" (`toHaveBeenCalledWith`). That's acceptable for thin
  subscribers, but there is no test of the adapter ordering (publish vs persist) or of bus teardown on reconnect across
  both processes.
- Duplicated fixtures: `WAWorkerBridge.test.ts`, `WhatsAppConnectionManager.*.test.ts` (3 files), and
  `workerConnection*.test.ts` each hand-roll a Worker/bridge/publisher mock. Move them into a shared
  `tests/helpers/waFakes.ts` (fake Worker with `_emitMessage/_triggerExit`, fake publisher, fake Baileys `ev`).

## 4. Refactor proposal

- [R-WA-01] **Characterization tests for the worker↔main contract.** Goal: a safety net before any refactor. Tests for
  `workerUtils` (sanitize/restore round-trip incl. Buffer, bigint, cycles), `WorkerEventBusAdapter` (sock stripping,
  app-state:sync skip, publish-then-emit order), `WAWorkerBridge` (every command type, init failure, `connection.update`
  shape, `wa-*` forwarding list), and `workerCommandRouter` (every case plus the error path). Files owned: new tests
  under `src/main/tests/workers/**`, plus `tests/helpers/waFakes.ts`. Depends on: none. Risk: low (tests only).
  Verify: `npx vitest run src/main/tests/workers`.
- [R-WA-02] **Fix wipe + logout loop (B-WA-02) and saveCreds (B-WA-05).** Files: `workers/whatsapp/socket/workerConnectionManager.ts`,
  `useLocalPrismaAuthState.ts`, and their tests. Depends on: none. Risk: med (data destruction path). Safety net:
  real-SQLite test with a vec0 table and a mocked 401 close. Verify: the test, plus manually unlinking the device on
  the phone → QR appears.
- [R-WA-03] **Replace BaileysPatcher with build-time patches (B-WA-03).** Goal: `patch-package` patches for rc13 only
  (drop #2 and #4), and remove the import-time fs writes. Files: `services/whatsapp/BaileysPatcher.ts` (delete),
  `src/main/index.ts:11-14`, `package.json` (postinstall), `patches/*`. Depends on: none. Risk: med (behaviour in the
  packaged app changes: app-state sync starts working). Safety net: an `AppStateSyncParser` test (exists) plus a smoke
  test that a mute toggled on the phone reaches the DB. Verify: `npm run dev` starts; packaged build receives
  `app-state.sync`.
- [R-WA-04] **Publish self identity + init supervision (B-WA-01, B-WA-04, B-WA-12).** Worker emits `wa-me`; bridge
  stores it; `init` goes through `sendCommand`; a failed init counts as worker death; preload exposes
  `onWaDisconnected`. Files: `WAWorkerBridge.ts`, `workerConnectionHandler.ts`, `workerCommandRouter.ts`,
  `whatsappWorker.types.ts`, `src/preload/index.ts`, `index.d.ts`, `App.tsx`. Depends on: R-WA-01. Risk: med.
  **CONTRACT-CHANGE** (new preload API and worker event). Verify: a quoted reply to your own message in a group shows
  the quote on the recipient's phone; killing the worker shows a disconnected banner.
- [R-WA-05] **Graceful worker shutdown (B-WA-09).** Add a `shutdown` command → `connectionManager.shutdown()` +
  `prisma.$disconnect()`; `bridge.stop()` awaits it with a timeout, then terminates. Files: `WAWorkerBridge.ts`,
  `workerCommandRouter.ts`, `whatsappWorker.types.ts`, `whatsapp.worker.ts`. Depends on: R-WA-01. Risk: med
  (quit/reconnect timing). Verify: the reconnect test and quit during sync; the log shows "Shutdown" before exit.
- [R-WA-06] **History sync state machine fixes (B-WA-06, -11, -13, -16).** Take on-demand chunks out of
  `activeChunks`; arm the inactivity timer on `open` when sync is incomplete; pass `skip` status through; publish
  `{jid,requestId,messageCount,error}`. Files: `WorkerHistorySyncManager.ts`, `workerConnectionManager.ts`,
  `workerConnectionHandler.ts`, `WAWorkerBridge.ts` (skipSync return), `WhatsAppConnectionManager.ts:350-375`.
  Depends on: R-WA-01. Risk: med. Safety net: new ON_DEMAND tests in `WorkerHistorySyncManager.test.ts`.
  Verify: on-demand scroll-back in the app; skip during sync.
- [R-WA-07] **Delete dead main-process twins.** Remove `HistorySyncManager.ts`, `WAEventWiringService.ts`,
  `IWAEventWiringService.ts`, `WACatchUpManager.ts`, `IWACatchUpManager.ts`, their three tests, and their
  `ServiceContainer.ts` entries. Also drop the bridge `groupFetchAllParticipating` mismatch (B-WA-15). Depends on: none.
  Risk: low (no production caller; `tsc` proves it). Verify: `npx tsc --noEmit`, full vitest.
- [R-WA-08] **Typed worker event contract.** Add a `WorkerDomainEventMap` (WAEventMap + `wa-*` window events with real
  payloads) and a typed `publish<K>()`. The bridge derives its forward and sock-injection lists from a single const
  table. Replace magic `6`s with named constants (split GROUP_HYDRATION from ON_DEMAND). Files: `whatsappWorker.types.ts`,
  `events/IWorkerEventPublisher.ts`, `WAWorkerBridge.ts`, `events/syncEvents.ts`, `constants.ts`, `workerConnectionHandler.ts`,
  `WorkerHistorySyncManager.ts`. Depends on: R-WA-01, R-WA-04, R-WA-06. Risk: med (touches every publish site; type-only
  unless a renderer channel changes). Verify: tsc and the contract tests.
- [R-WA-09] **Table-driven command router.** Split into `handlers/*.ts`, one `reply()` helper, and an injected
  `postMessage` for testability. Files: `routing/workerCommandRouter.ts` (+ new `routing/handlers/`). Depends on:
  R-WA-01, R-WA-05. Risk: low. Verify: router tests.
- [R-WA-10] **Group metadata cache (B-WA-08).** Make the cache a long-lived `WorkerGroupCache` service, fill it from
  hydration and group events, and inject it into `connectSocket`. Files: `connectSocket.ts`, `workerConnectionManager.ts`,
  `bootstrapWorkerRepositories.ts`, `ContactGroupSubscriber.ts` (or a new worker subscriber). Depends on: none.
  Risk: low. Verify: the log shows no `groupMetadata` IQ per send.
- [R-WA-11] **Encrypted reaction attribution + embedding worker races (B-WA-07, B-WA-10).** Files:
  `secret/MessageReactionStrategy.ts`, `secret/ISecretMessageStrategy.ts`, `SecretMessageService.ts`,
  `workers/embedding/embedding.worker.ts`, and tests. Depends on: none. Risk: low. Verify: new fromMe=true reaction
  test; setModel-during-load test.
- [R-WA-12] **Unify login/wipe policy in one place.** The worker owns creds; main stops duplicating the
  hasCreds/orphan-wipe logic and asks the worker, or the other way round. The worker wipe reuses `DataWipeService`
  table-filtering logic moved to a shared, electron-free module. Files: `WhatsAppConnectionManager.ts`,
  `workerConnectionManager.ts`, `services/DataWipeService.ts`. Depends on: R-WA-02, R-WA-07. Risk: high (data wipe
  semantics). Safety net: fresh-login, orphan-wipe, and logout integration tests on real SQLite.
- [R-WA-13] **Retire `syncFullHistory` plumbing.** Files: `WAWorkerBridge.start`, `whatsappWorker.types.ts`,
  `WorkerHistorySyncManager`, `ipcHandlers.ts` (`set-sync-full-history`), preload, `api.service.ts`. Depends on: R-WA-06.
  Risk: low. **CONTRACT-CHANGE** (IPC channel and preload API removed).

Hotspots that limit parallelism: `WAWorkerBridge.ts` (R-04/05/06/08), `whatsappWorker.types.ts` (R-04/05/08),
`workerCommandRouter.ts` (R-04/05/09), `workerConnectionManager.ts` (R-02/06/10/12), `WorkerHistorySyncManager.ts`
(R-06/08/13). R-02, R-03, R-07, R-10, and R-11 can run in parallel right away.

## 5. Top 5

1. Worker-side logout wipe always fails once `vec_messages` exists (`no such module: vec0`), so a phone-side unlink loops with dead creds and never shows a QR (B-WA-02, reproduced).
2. `BaileysPatcher` is broken on the pinned Baileys rc13: it throws at startup in dev, overwrites upstream's newer `profilePictureUrl`, and applies nothing in packaged builds, so phone-side app-state sync (mute/pin/star/favourite stickers) is dead in production (B-WA-03).
3. `WAWorkerBridge.user` is never set, because `connection.update` carries no `creds`; main-process sends lose self identity (quoted replies to your own messages have no participant) (B-WA-01).
4. Worker supervision has holes: a failed `init` is silently dropped with no retry, the worker is only ever hard-terminated (in-flight keystore writes lost), `saveCreds` still swallows errors despite P2-S10-03 being marked fixed, and the renderer never receives `wa-disconnected` (B-WA-04/05/09/12).
5. On-demand history (a7c24f4..6aabae0) has no tests. ON_DEMAND chunks can block `finishSync` forever, and failures are never announced. Meanwhile about 475 lines of dead main-process twins (`HistorySyncManager`, `WAEventWiringService`, `WACatchUpManager`) plus their tests hide the real worker code paths (B-WA-06/16, R-WA-07).
