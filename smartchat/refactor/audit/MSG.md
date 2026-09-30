# MSG slice audit — message pipeline (`services/messages/**`, `utils/**`, `utils.ts`)

Scope read in full: every file under `src/main/services/messages/**` (incl. `formatters/`, `processors/`),
`src/main/utils/*.ts`, `src/main/utils.ts`. To trace the two user bugs I also read
`services/sync/SyncMessagesHandler.ts`, `historySync.ts`, `workers/whatsapp/services/WorkerHistorySyncManager.ts`,
`workers/whatsapp/events/*`, `workers/whatsapp/bootstrapWorkerRepositories.ts`, `workers/bridge/WAWorkerBridge.ts`,
`services/whatsapp/WAEventHandler.ts`, `subscribers/{Persistence,UIBroadcast}Subscriber.ts`, the Baileys 7.0.0-rc13
`Utils/process-message.js` / `Utils/messages.js`, and the renderer `MessageItem.tsx` quote rendering.
I checked the fixed P2-S2-01..08 items and am not re-reporting them. Where noted, I ran `preserveContextInfo`
against real payloads in a scratch esbuild bundle, so those results are measured.

---

## 0. User-reported bugs: root cause

### "Reactions are lost in history sync" (root cause confirmed: B-MSG-01, with B-MSG-02 contributing)
Path: `WorkerEventDispatcher` → `WorkerHistorySyncManager.handleSyncChunk` → `handleHistorySync` →
`SyncMessagesHandler.processMessages` (per 200-msg batch) → `ReactionRepository.bulkSyncReactions`.
- Standalone `reactionMessage` rows in the history payload become `PendingReaction`s
  (`SyncMessagesHandler.ts:98-103`). They are written **in the same batch** at `:118`.
- `bulkSyncReactions` then **drops every reaction whose target `Message` row does not exist yet**
  (`ReactionRepository.ts:108-133`: `valid = unique.filter(r => existingMessageIds.has(r.targetId) …)`).
  Nothing is queued or retried.
- A reaction is dropped for good whenever its target message lands in a later 200-row batch, a later chunk
  (a RECENT chunk carrying today's reaction to a message that only arrives in a FULL chunk), or an on-demand page,
  or is never synced at all. History payloads are not ordered by dependency, so this is common.
- Nested `WebMessageInfo.reactions` are safe, because the target is the row that carries them and is inserted first
  (`:111-118`). The loss is therefore specific to inline reaction rows. That matches the user seeing some reactions
  and not others.
- Contributing: when a batch contains a duplicate id, `createMany` fails and the fallback transaction can fail too.
  That drops the whole batch's messages, and with them every reaction that targets them (B-MSG-02).

### "When editing a replied message, context is lost" (several confirmed defects; no single line)
Baileys 7 turns every MESSAGE_EDIT (incoming, or our own echo because of `emitOwnEvents`) into **two** events
(`process-message.js:364-380`):
1. `messages.upsert` {protocolMessage} → `ProtocolMessageProcessor` → `message:edited` → `MessageRepository.editMessage`.
   This merge is correct.
2. `messages.update` {message:{editedMessage:{message:X}}} → `WAEventHandler.tryEmitDecryptedMessage:199` →
   `message:decrypted` → `MessageRepository.decryptMessage` + `UIBroadcastSubscriber.onDecrypted`.
   This one runs **last** (`workerEventDispatcher.ts:33-38`, and `WAWorkerBridge.emitChain` keeps the order), so it
   decides the final state:
- **B-MSG-03 (live UI, context lost):** `UIBroadcastSubscriber.ts:184` only rebuilds the quote when the edited payload
  has *no* contextInfo. If X carries any contextInfo without `quotedMessage` (disappearing-chat `expiration`,
  mentions), it sends the raw `{editedMessage:…}` (`:196`), and the renderer's `isReply` (`MessageItem.tsx:375-384`)
  becomes false. The quote vanishes until the chat is reloaded.
- **B-MSG-04 (DB, reply content corrupted):** `preserveContextInfo` (`messageUtils.ts:209-221`) does not look inside the
  `editedMessage` wrapper. It rebuilds `{extendedTextMessage:{text:'', contextInfo}}`: the **text is blanked** and
  `messageContextInfo` is dropped (verified by running it). The quote survives in the DB, but forwarding this message,
  or quoting it in a new reply, sends empty text.
- **B-MSG-05 (history sync, context lost for good):** when the original reply and its edit row share a sync batch,
  both have the same id. `createMany` then fails on the duplicate primary key, and the fallback
  `upsert({update: m})` (`MessageRepository.ts:269-272`) overwrites the reply with the edit's bare content without
  running `preserveContextInfo`. The quote is lost. If the edit sorts first, the edit is lost instead.
- SUSPECT: our outgoing edit (`MessageActionService.ts:131-134`) sends `{text, edit}` without the original contextInfo.
  Baileys attaches any `contextInfo` to the `protocolMessage`, not to the `editedMessage` (`messages.js:514-532`).
  Recipient clients may therefore render our edited reply without its quote. Needs a device test.

---

## 1. Bugs (confirmed)

- [B-MSG-01] **high** `src/main/services/messages/ReactionRepository.ts:108-133` (called from `services/sync/SyncMessagesHandler.ts:118`) — history-sync reactions whose target is not in the DB yet are silently discarded.
  Scenario: chunk 1 (RECENT) holds reaction R → msg M; M arrives in chunk 3 (FULL). R is filtered out at `:130` and never retried, so the reaction is missing forever.
  Fix: keep unmatched reactions in a `PendingReaction` table (or an in-memory map for the whole sync session) and flush it after each `bulkSyncMessages`/`finishSync`. Alternatively, build all message rows for a chunk before writing any reactions.
  The live path has the same hole: `upsertReaction` (`:40-48`) only logs FK failures ("Failed to upsert reaction") for reactions that arrive before their target.

- [B-MSG-02] **high** `src/main/services/messages/MessageRepository.ts:267-278` (also `bulkCreateMessages:125-135`) — a batch containing the same id twice (an original plus its edit or revoke row, which is `SyncMessagesHandler._parseMessageProperties:195-217` remapping `finalId` to the target) makes `createMany` fail on the duplicate primary key. The fallback then runs `upsert({update: m, create: m})` for every row.
  Effects: (a) the later duplicate overwrites the earlier one wholesale, with no `preserveContextInfo`/`preserveLocalUri` (B-MSG-05); (b) the whole 200-row batch drops to a slow per-row transaction; (c) if any row fails, the whole fallback transaction rolls back, only a `console.error` is logged, and all its messages (and the reactions that target them) are lost.
  Fix: fold duplicates per id inside `bulkSyncMessages` before the insert. Apply edits and revokes onto the original row in memory (merge contextInfo, set `isEdited`/`isDeleted`), then run `createMany` on unique ids.

- [B-MSG-03] **med** `src/main/services/whatsapp/subscribers/UIBroadcastSubscriber.ts:184-196` — `onDecrypted` handles the Baileys edit echo (`{editedMessage:{message:X}}`). It keeps the quote only when `!decryptedCtx`. When X has a partial contextInfo (e.g. `{expiration}`), `finalContent = JSON.stringify(event.content)`, so the renderer loses the reply bubble live.
  Fix: use the same rule as `preserveContextInfo`: merge when `!decryptedCtx?.quotedMessage && existingCtx?.quotedMessage`. Better still, share one merge helper (R-MSG-02).

- [B-MSG-04] **med** `src/main/utils/messageUtils.ts:204-221` (via `MessageRepository.decryptMessage:237-240`) — if the new content is `{editedMessage:{message:…}}`, then `newParsed.conversation` and `newParsed.extendedTextMessage` are both undefined. The rebuilt message gets `text: ''` and loses `messageContextInfo`. This runs on **every edit of a reply** (the Baileys `messages.update` echo), after `editMessage` has already written the correct content.
  Consequences: `forwardMessage` (`MessageActionService.ts:225-234`) forwards an empty text, and `buildQuotedContextInfo` (`MessageSenderService.ts:51-60`) quotes an empty text.
  Fix: in `preserveContextInfo`, operate on `unwrapMessage(newParsed)` and read text from it. Or have `WAEventHandler.tryEmitDecryptedMessage` skip `editedMessage` updates, since `message:edited` already covers them.

- [B-MSG-05] **med** history-sync edit of a reply → `MessageRepository.ts:269-272`: the quote is replaced by bare edited content (see B-MSG-02). Reverse order (edit row before original) → `updateExistingMessages:310-313` writes the original text and `isEdited=false`, so the edit is reverted.
  Fix: part of the B-MSG-02 fix. Also only allow `isEdited`/`isDeleted` to go false→true in `updateExistingMessages` (today any re-sync can un-edit or un-delete a message).

- [B-MSG-06] **med** `src/main/services/messages/MessageRepository.ts:185-205` — `editMessage` always rebuilds the message as text. For a caption edit (`editedContent = {imageMessage:{caption}}`): with no context it stores `messageType:'conversation'` and content without the url/mediaKey/localURI; with a quote it converts the image into an `extendedTextMessage`. Either way the media bubble disappears and the media can no longer be downloaded.
  `UIBroadcastSubscriber.onEdited:116-143` repeats the same logic. Fix: when the stored type is a media type, patch the caption into the existing media node instead.

- [B-MSG-07] **low** `src/main/services/messages/MessageQueryRepository.ts:91-116` — `findLastMessagesForChats` uses Prisma `distinct: ['chatJid']`. On SQLite Prisma applies `distinct` in memory, so this loads **every message of every listed chat** to pick one per chat (the chat list calls it for all chats).
  Its ordering also lacks the `rowid DESC` tie-break used by `findLastMessage:62`, so previews can disagree when timestamps tie.
  Fix: one raw query using `ROW_NUMBER() OVER (PARTITION BY chatJid ORDER BY timestamp DESC, rowid DESC)`.

- [B-MSG-08] **low** `src/main/services/messages/MessageRepository.ts:312-313` — `updateExistingMessages` copies `isDeleted`/`isEdited` from sync rows, which always define them (`SyncMessagesHandler.ts:376-377`). An overlapping history chunk or on-demand page that re-delivers an original therefore writes `isDeleted=false`/`isEdited=false` over live state (un-delete, un-edit).
  Fix: only set these flags when they are true.

- [B-MSG-09] **low** `src/main/services/messages/MessageService.ts:264-306` — `bulkPersistMessages` removes ids already in the DB (`findExistingIds`) but not duplicates inside the batch. The duplicate then hits the same createMany → full-row-upsert fallback (B-MSG-02). Baileys `append` batches do sometimes re-deliver a message.
  Fix: dedupe by id before `bulkCreateMessages`.

### SUSPECT (unconfirmed)
- `processors/ReactionMessageProcessor.ts:45` and `SyncMessagesHandler._extractInlineReaction:402-403` read `reactionMessage` from the **raw** content, while the type check uses the **unwrapped** content. A reaction wrapped in `ephemeralMessage` (Baileys itself runs `normalizeMessageContent` first) is classified as a reaction but never stored. Live reactions are still saved through `messages.reaction` → `processReaction`; history ones are lost.
- `MessageActionService.editMessage:131-160` writes on the main process while the worker's echo writes (`editMessage`, then `decryptMessage`) race it. The last writer wins, which today is the worker's B-MSG-04 content.
- `MediaService.downloadAndCacheMedia:289-313` reads, modifies and writes the whole `content` across a network download, so an edit or decrypt that lands in between can be overwritten. `preserveContextInfo` protects only the quote.
- `MessageSenderService.buildQuotedContextInfo:56-58` strips contextInfo only from `Object.keys(rawQuoted)[0]`. That fails when the first key is `messageContextInfo` or a wrapper (`ephemeralMessage`), so a nested quote chain is sent.
- `parseBaileysTimestamp` (`messageUtils.ts:18`): `BigInt(ts)` throws a RangeError on a non-integer number or string; no caller guards it.

---

## 2. Code quality / design issues (ranked)

1. **The edit/quote merge is implemented five times, differently each time.** This is the direct cause of B-MSG-03/04/06.
   The copies: `MessageRepository.editMessage:155-220`, `messageUtils.preserveContextInfo:192-228`, `UIBroadcastSubscriber.onEdited:84-160`, `UIBroadcastSubscriber.onDecrypted:162-205`, `MessageActionService.getUpdatedEditContent:82-107`. The renderer has its own `unwrapMessage` (`MessageItem.tsx:38-70`).
   There should be one pure `applyEdit(existingContent, editedContent, editedText) → {content, messageType, textContent}`.
2. **Two parallel ingestion pipelines** (live `MessageService`/processors vs history `SyncMessagesHandler`) re-implement parsing: stub/ciphertext/system handling (`MessageParser.ts:80-95`, `MessageService.ts:159-172`, `SyncMessagesHandler.ts:168-218`), reactor JID resolution (`MessageIdentityResolver.resolveReactorJid:48-70` vs `SyncMessagesHandler.ts:329-333, 436-441`), and reaction timestamp parsing (`MessageService.ts:571-578` vs `SyncMessagesHandler.ts:445-450`).
3. **Every edit and every live reaction is processed twice.** Edits: `message:edited` plus the `message:decrypted` echo. Reactions: `ReactionMessageProcessor` on upsert plus `processReaction` on Baileys `messages.reaction` (`process-message.js:411-421`).
   The reaction processor also returns a `ProcessedMessage`, which `WAEventHandler.processRealtimeMessage:116-131` emits as `message:incoming`.
   `tryEmitDecryptedMessage` should ignore `editedMessage` updates, and one reaction path should own persistence.
4. **"Me" identity resolution duplicated three times:** `ReactionMessageProcessor.resolveMeReactorId:16-35`, `MessageIdentityResolver.resolveMeSenderId:87-105`, `MessageActionService.resolveReactorId:271-288`. The processor already has access to `identityResolver`, so it should use it.
5. **Text extraction duplicated four times:** `messageUtils.extractTextContent:104-119`, `MessageParser.extractTextContent:120-145`, `ProtocolMessageProcessor:31-36`, `WAEventHandler.handleProtocolEdit:246-251`.
6. **God-ish orchestrator:** `MessageService.ts` (632 lines) implements four interfaces (writer/query/parser/processing): parsing, bulk persistence, read and enrichment, reaction processing, media filenames.
   It breaks encapsulation with `this.parser['_safeSerialize']` (`:146`) and passes a concrete `SecretMessageService` through `IMessageServiceDependencyAccessor` (`processors/IMessageProcessorStrategy.ts:28`).
   Other large files: `MediaService.ts` 512, `MessageSenderService.ts` 417, `MessageRepository.ts` 413, `MessageQueryRepository.ts` 378, `MessageActionService.ts` 371.
7. **Serialization cost:** each history message is JSON round-tripped up to three times: `isSpecialMessage` in `WAEventHandler.processBacklogMessages:95`, then again inside `parseMessageSync:63` → `isSpecialMessage:42`, then `_safeSerialize` at `:65`.
   `dispatchProcessors` (`MessageService.ts:121-126`) also issues a chat upsert for every live message.
8. **`unwrapMessage` mutates its input** (`messageUtils.ts:149-158` writes the outer contextInfo onto the inner node). Callers later re-serialize the object they passed in (`MediaService.ts:290-313`, `extractContextInfoFromContent` on the caller's object), which silently rewrites stored JSON. It should be pure, or clone.
9. **Error swallowing hides data loss:** `ReactionRepository.upsertReaction:46`, `bulkSyncReactions:159-174`, `MessageRepository.upsertMessage:107-110` (returns a fake "saved" shape when the write failed), `insertNewMessages:273-277`, `updateExistingMessages:318-322`, `editMessage:217`, `decryptMessage:250`.
   Callers cannot tell success from failure. Return a result, or throw and let the pipeline decide.
10. **Domain services import `electron`:** `MediaService.ts:2`, `FavoriteStickerService.ts:2`, `StickerMetadataService.ts:3`. `StickerMetadataService.ts:181` also runs ffmpeg setup at import time as a module-level singleton, pulled in by `MessageSenderService.ts:16`.
    There are worker-specific shadow classes (`WorkerMediaService`, `WorkerFavoriteStickerService`) because of this. Inject a paths/storage port instead (`LocalFileStorage` already exists).
11. **Duplicated helpers:** `streamToBuffer`/`ensureBuffer` (`MediaService.ts:80-111` vs `FavoriteStickerService.ts:11-17,166-186`); `utils/contactUtils.getDisplayName` vs `ContactNameResolver.getDisplayName` (`contacts/ContactNameResolver.ts:21-40`, byte-identical); mute normalisation (`WAEventHandler.ts:42,321-333` vs `messageUtils.normalizeMuteExpirationSeconds:31-47`).
12. **Dead code:** `src/main/utils.ts` (barrel with no importers); `getMessagePreviewLabel` (`messageUtils.ts:272-276`, reachable only through that barrel).
13. **Casts:** about 172 `as` casts under `services/messages` and 4 explicit `any` (`MessageActionService.ts:166`, `MediaService.ts:432`, `messageUtils.ts:171`, `IMediaService.ts`). Many are `as unknown as` through Baileys types (e.g. `MessageService.ts:93`, `ReactionMessageProcessor` context), because content is `Record<string, unknown>` throughout. There is no typed `StoredMessageContent`.
14. **Magic strings:** message-type literals (`'reactionMessage'`, `'extendedTextMessage'`, `'system'`, `'ciphertext'`), the placeholder `'Waiting for this message…'` (`MessageService.ts:163`, `MessageParser.ts:86`, `SyncMessagesHandler.ts:186`, renderer), protocol types `14`/`0` (`ProtocolMessageProcessor.ts:21,29`, `SyncMessagesHandler.ts:192-193`) even though `PROTOCOL_TYPE_*` constants exist.
15. `MessageService.getChatMessages:416` / `getMessagesAroundId:507` run `allReactions.filter` once per message (O(n·m)); group into a Map once.

---

## 3. Test quality

**No tests at all:** `MessageRepository.decryptMessage` (the B-MSG-04 path), `bulkSyncMessages` with duplicate ids in a batch, `updateExistingMessages` flag regressions, `MessageService.bulkPersistMessages`, `MessageService.processMessage` real dispatch (the only test mocks every processor), `ProtocolMessageProcessor` edit payload shapes (wrapped / media caption), `MediaHelper.getMediaSendOptions`/`resolveExtension`, `utils/contactUtils.ts`, `MessageQueryRepository.findLastMessagesForChats`, and 8 of the 10 formatters (`tests/messages/formatters/MessageFormatters.test.ts` covers only conversation and deleted).

**No end-to-end edit or reaction scenario.** Every existing test exercises one layer against a hand-built payload:
- `repositories/MessageRepository.test.ts:128-169` ("edit a replied message and preserve quoted contextInfo") calls `editMessage` alone and passes. The real bug only appears after the follow-up `decryptMessage({editedMessage:…})` that Baileys always emits. Nothing replays Baileys' actual (upsert + update) event pair.
- `repositories/ReactionRepository.test.ts:53` ("bulk sync reactions, validating existence") asserts the dropping behaviour behind B-MSG-01 as correct. There is no cross-batch or cross-chunk test in `services/sync/SyncMessagesHandler.test.ts`.

**Weak or over-mocked tests:**
- `services/MessageService.process.test.ts:61-73`: the processor is mocked with `supports→true`, so the test only proves that a mock was called (`toHaveBeenCalled`). The chat-upsert ordering and the requiresChat split are never checked.
- `services/MessageActionService.test.ts`: `editMessage` and `reactToMessage` are untested. Everything is `any`-typed mocks.
- `services/MessageService.query.test.ts` has one happy-path test; there are no reaction-grouping or `resolveLid` cases.
- `services/FavoriteStickerService.test.ts` mocks `fs` and `prisma` wholesale. `syncFavoriteSticker`/`handleDownloadedSticker` are untested.
- `messages/MessageParser.test.ts` has no stub/ciphertext/REVOKE or wrapped-message cases.

**Shared fixtures:** each test file builds its own ~12-argument `MessageService` constructor (`process.test`, `query.test`, `reindex.test`). A shared `makeMessageService(overrides)` factory and a `baileysEditEvents(targetKey, editedMsg)` fixture would remove the duplication and make realistic scenarios cheap. Repository tests use per-worker SQLite (`tests/helpers.ts:15-24`), which is fine; there is no shared-state problem.

---

## 4. Refactor proposal

Hotspots (limit parallelism): `utils/messageUtils.ts`, `services/messages/MessageRepository.ts`, `services/whatsapp/subscribers/UIBroadcastSubscriber.ts`, `services/sync/SyncMessagesHandler.ts`. R-MSG-02/03/04 all touch `MessageRepository.ts`, so run them one after another.

- [R-MSG-01] **Characterization tests for edit and reaction flows.** Goal: a safety net before changing anything.
  - Tests to add:
    - Replay the Baileys edit pair (upsert protocolMessage + update editedMessage) through `ProtocolMessageProcessor` → `editMessage` → `decryptMessage` on a real test DB, for a plain reply, a reply with `contextInfo.expiration`, and an image-caption edit.
    - `bulkSyncMessages` with an original and its edit in the same batch and in separate batches.
    - `SyncMessagesHandler` with a reaction in batch 1 whose target is in batch 2.
    - Mark the currently-buggy expectations `it.fails` so they document the bugs.
  - Files: new `src/main/tests/messages/editFlow.int.test.ts`, `src/main/tests/services/sync/SyncMessagesHandler.reactions.test.ts`, shared `src/main/tests/factories/messageFactories.ts`.
  - Depends on: none. Risk: low (tests only). Verify: `npx vitest run src/main/tests/messages src/main/tests/services/sync`.

- [R-MSG-02] **Single pure `applyEdit` / `mergeContextInfo` module** (fixes B-MSG-03/04/06). Goal: one function that unwraps the `editedMessage`/ephemeral wrapper, keeps quote plus `messageContextInfo`, patches the caption for media, and returns `{content, messageType, textContent}`.
  - Use it in `MessageRepository.editMessage`, `decryptMessage`, `updateAndFetchMessageWithSender`, `UIBroadcastSubscriber.onEdited`/`onDecrypted`, and `MessageActionService.getUpdatedEditContent`.
  - Also make `unwrapMessage` non-mutating.
  - Files: `src/main/utils/messageUtils.ts` (or a new `src/main/services/messages/editMerge.ts`), `MessageRepository.ts`, `MessageActionService.ts`, `subscribers/UIBroadcastSubscriber.ts`.
  - Depends on: R-MSG-01. Risk: med (it changes stored JSON shape for edited rows, though not the schema). Safety net: R-MSG-01 edit-flow tests turned green; the existing `MessageRepository.test.ts` edit tests.
  - Verify: the vitest suites above; manually edit a reply (in a normal chat and in a disappearing-messages chat) and confirm the quote survives live and after reload, and that forwarding the edited message carries the new text.

- [R-MSG-03] **Stop double-processing edits.** Goal: `WAEventHandler.tryEmitDecryptedMessage` skips `update.message.editedMessage` (already handled by `message:edited`), and ciphertext decrypts keep their current path.
  - Files: `src/main/services/whatsapp/WAEventHandler.ts`, its test.
  - Depends on: R-MSG-02 (so there is a single merge). Risk: med. If some Baileys edit never arrives as an upsert (e.g. an edit of a secret message decrypted later), dropping it here loses the edit. Check `SecretMessageService` first.
  - Verify: the R-MSG-01 flow test with only the update event, plus a manual edit from the phone.

- [R-MSG-04] **Batch-safe `bulkSyncMessages`** (fixes B-MSG-02/05/08/09). Goal: fold rows by id in memory (original ⊕ edit ⊕ revoke via `applyEdit`), make flags monotonic (only false→true), use `createMany` on unique ids, and dedupe in `bulkPersistMessages` too.
  - Files: `MessageRepository.ts`, `MessageService.ts` (bulkPersist), `services/sync/SyncMessagesHandler.ts` (let edit/revoke rows carry `targetId` explicitly instead of overwriting `id`).
  - Depends on: R-MSG-02. Risk: med (history sync is the hottest write path). Safety net: R-MSG-01 sync tests and the existing `SyncMessagesHandler.test.ts`/`MessageRepository.test.ts`.
  - Verify: vitest; log out and back in with a full-history sync of a test account and compare message counts and edited or deleted flags.

- [R-MSG-05] **Deferred reactions for history sync** (fixes B-MSG-01). Goal: reactions whose target is missing are kept in a sync-session map (or a small `PendingReaction` table) and flushed after each chunk and in `finishSync`. The live `upsertReaction` path checks that the target exists and defers instead of hitting the FK.
  - Files: `ReactionRepository.ts`, `IReactionRepository.ts`, `SyncMessagesHandler.ts`, `workers/whatsapp/services/WorkerHistorySyncManager.ts`. Optionally `prisma/schema.prisma`: **CONTRACT-CHANGE (DB schema)** if a persistent table is chosen; the in-memory map needs no schema change.
  - Depends on: R-MSG-01. Risk: med. Memory grows with unmatched reactions, so it needs a bound; the persistent variant needs a migration.
  - Verify: the R-MSG-01 cross-batch test goes green; a real resync shows reactions on old messages.

- [R-MSG-06] **One reaction pipeline.** Goal: pick `processReaction` (from `messages.reaction`) as the single live writer. `ReactionMessageProcessor` then only classifies the message and returns `null` (so no `message:incoming` for reactions), uses the unwrapped content, and gets its "me" id from `IMessageIdentityResolver.resolveMeSenderId`. Delete `MessageActionService.resolveReactorId` in favour of the same resolver.
  - Files: `processors/ReactionMessageProcessor.ts`, `MessageService.ts`, `MessageActionService.ts`, `MessageIdentityResolver.ts`, tests in `tests/messages/processors/`.
  - Depends on: none (can run in parallel with R-MSG-02). Risk: med. It changes which events the renderer gets for a reaction; check `useMessages`/`NotificationSubscriber` handling of `reactionMessage` `new-message`.
  - Verify: vitest; react, un-react and react from the phone.

- [R-MSG-07] **Split `MessageService`.** Goal: extract `MessageReadService` (getChatMessages, getMessagesAroundId, enrich*, collectAdditionalJidsForResolve, reaction grouping via Map) and `MessageIngestService` (processMessage, bulkPersist, processReaction). Keep `MessageService` as a thin facade that implements the same four interfaces so ServiceContainer wiring does not change. Remove `parser['_safeSerialize']` (make it a public static helper).
  - Files: `services/messages/MessageService.ts`, new `MessageReadService.ts`/`MessageIngestService.ts`, `ServiceContainer.ts`, `workers/whatsapp/bootstrapWorkerRepositories.ts`.
  - Depends on: R-MSG-04 and R-MSG-06 (avoid conflicts). Risk: low-med (pure move). Safety net: all `MessageService.*.test.ts` plus R-MSG-01.
  - Verify: `npx vitest run src/main/tests`, `npm run typecheck`.

- [R-MSG-08] **Unify parsing helpers.** Goal: one `extractTextContent`/`classifyStub` in `messageUtils`, used by `MessageParser`, `ProtocolMessageProcessor`, `WAEventHandler`, and `SyncMessagesHandler`. Serialize once per message in `parseMessageSync`. Use the `PROTOCOL_TYPE_*` constants.
  - Files: `utils/messageUtils.ts`, `MessageParser.ts`, `processors/ProtocolMessageProcessor.ts`, `whatsapp/WAEventHandler.ts`, `sync/SyncMessagesHandler.ts`.
  - Depends on: R-MSG-04 (both touch SyncMessagesHandler). Risk: low. Safety net: `messageUtils.test.ts`, `MessageParser.test.ts` extended with stub, ciphertext and wrapped cases first.

- [R-MSG-09] **Media and sticker infrastructure cleanup.** Goal: share `streamToBuffer`/`ensureBuffer` (next to `shaUtils`), inject a paths port instead of importing `electron` in `MediaService`/`FavoriteStickerService`/`StickerMetadataService`, make `stickerMetadataService` lazily constructed, and write media files atomically (write to a temp file, then rename).
  - Files: `services/messages/{MediaService,FavoriteStickerService,StickerMetadataService,MessageSenderService}.ts`, `services/storage/LocalFileStorage.ts`, `workers/whatsapp/services/Worker{Media,FavoriteSticker}Service.ts`.
  - Depends on: none. Risk: low-med (worker/main wiring). Verify: `MediaService.test.ts`, `FavoriteStickerService.test.ts`; send a sticker; download media.

- [R-MSG-10] **Query and dead-code tidy.** Goal: rewrite `findLastMessagesForChats` with a window function (B-MSG-07); delete `src/main/utils.ts` and `getMessagePreviewLabel`; make `utils/contactUtils.getDisplayName` the single implementation and have `ContactNameResolver.getDisplayName` delegate to it; route `WAEventHandler` mute handling through `normalizeMuteExpirationSeconds`.
  - Files: `MessageQueryRepository.ts`, `utils.ts`, `utils/messageUtils.ts`, `utils/contactUtils.ts`, `contacts/ContactNameResolver.ts`, `whatsapp/WAEventHandler.ts`.
  - Depends on: none. Risk: low. Verify: `repositories/MessageQueryRepository.test.ts` plus a new last-message tie test; chat-list preview in the app.

---

## 5. Top 5
1. **Reactions lost in history sync, root cause confirmed:** `ReactionRepository.bulkSyncReactions` (`:108-133`) permanently drops every reaction whose target message isn't in the DB yet. Targets in a later batch, chunk or on-demand page are never retried (B-MSG-01 → R-MSG-05).
2. **Edited replies lose their quote because every edit is written twice.** Baileys emits both a protocol upsert and an `editedMessage` update. The second write goes through `preserveContextInfo`/`UIBroadcastSubscriber.onDecrypted`, which don't unwrap `editedMessage`: the DB text is blanked, and the live UI drops the quote when the edit carries partial contextInfo (B-MSG-03/04 → R-MSG-02/03).
3. **Duplicate ids in a sync batch break `bulkSyncMessages`.** The original and its edit/revoke row share an id, so `createMany` fails and the fallback overwrites whole rows with no context/localURI preservation. Reply context and edits are lost, and if the fallback fails the whole batch is gone (B-MSG-02/05/08).
4. **Caption edits destroy media rows:** `MessageRepository.editMessage` always rebuilds the message as text, dropping the image/video and its mediaKey (B-MSG-06).
5. **Five divergent copies of the edit/quote merge logic, and no test that replays Baileys' real edit/reaction event sequence.** The existing "preserve quoted contextInfo" test passes while the feature is broken. Build the R-MSG-01 characterization suite first.
