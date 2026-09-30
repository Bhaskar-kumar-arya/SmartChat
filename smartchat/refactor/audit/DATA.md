# DATA slice audit: chats, sync, contacts, persistence

Scope read in full: `src/main/services/{chats,chats/sync,sync,contacts,storage}/**`, `src/main/db/schema-migrations.ts`,
`src/main/domain/**`, `prisma/schema.prisma`. I also read these call sites: `historySync.ts`, `MessageService.ts:265-300`,
`WAWorkerBridge.ts:57,121-131`, `ContactGroupSubscriber.ts`, `ContactCacheSyncSubscriber.ts`, `MentionMenu.tsx:25`.
I checked the prior trackers (`bug-audit/`, `bug-audit-pass2/`) and left out anything they already list as fixed, except where a fix is incomplete.

---

## 1. Bugs (confirmed)

- [B-DATA-01] **high** `src/main/services/contacts/LidPnLinker.ts:54-71`: the P2-S5-01 fix is incomplete. `linkLidAndPn` still re-points a LID alias off a stub identity without migrating the stub's rows.
  Scenario: group history sync creates stub A for `X@lid`, with messages, reactions and ChatMember rows. Later a `lid-mapping.update`, history `lidPnMappings` or a group participant with a phone number calls `linkLidAndPn(X@lid, P)`, and P already has identity B. Line 59 moves the alias to B. `countIdentityReferences(A)` then sees messages > 0, so A is not deleted (line 66). Result: A keeps all of X's history but has **no aliases left**. `deduplicateIdentities` can never collect A, because it filters on `aliases: { some: { type: 'LID' } }` (IdentityReconciliationService.ts:26). Past messages show under A and new ones under B, so the contact is permanently split.
  This is the same defect P2-S5-01 fixed in `ContactService.upsertContact:262-265`. It survives on the path that runs most often (7+ callers: SyncContactsHandler, SyncChatsHandler, GroupMembershipService, ContactNameResolver tier-3, IdentityReconciliationService.reconcileLidPnFromJids, and others).
  `LidPnLinker.test.ts:75-83` and `milestone3.test.ts:369` only cover a stub with no references.
  Fix: when `orphanId` is set, call `identityRepository.mergeIdentityInto(orphanId, identityId)` in place of the count/delete step. That also carries the stub's displayName/pushName over to B, which the current delete throws away.

- [B-DATA-02] **med** `src/main/services/chats/sync/MembershipSyncHandler.ts:132-147` together with `:195-201` and `:253-263`: a LID-only participant whose phone number is known only from `LidMap` is silently dropped from `ChatMember`.
  Scenario: the participant is `{id:'X@lid'}` with no `phoneNumber`, e.g. the group owner, whose `ownerPn` feeds `lidMapUpserts` at `:111-115`. Pass 1 finds no alias, derives `canonicalPn` from `lidMapUpserts` or `existingLidMap`, and queues that PN for creation (`:137-142`). Pass 2 only links when `p.pn` is set (`:172`), and its lookups (`:195-201`, `:253-259`) consult only `p.pn`, `p.lid` and `p.id`. No alias `X@lid` exists, so `identityId` is null. The result: no alias for `X@lid`, no ChatMember row, and a PN Identity with no LID link. The same thing happens on every re-hydration.
  Fix: record the derived PN per participant (`effectivePn = p.pn ?? derivedPn`) and use it in pass 2 and phase 4, so the `LID→PN identity` alias gets created.

- [B-DATA-03] **med** `MembershipSyncHandler.ts:245-266` and `SyncRepository.ts:289-326`: full group hydration never removes members.
  `bulkUpsertChatMembers` only inserts or updates role. Removals are handled only for live `group-participants.update` events (`ContactGroupSubscriber.ts:152`).
  Scenario: someone leaves a group while the app is closed, or during a reconnect gap. `groupFetchAllParticipating` → `hydrateGroups` returns the authoritative list, but the stale ChatMember row persists forever. It then shows up in AI context, member lists and mention scans.
  Fix: in phase 4, delete members of each hydrated `chatJid` whose `identityId` is not in that group's resolved set, using one `deleteMany` per group with `identityId notIn`.

- [B-DATA-04] **low** `src/main/services/chats/ChatService.ts:182`: `isMe: p.id === s.user.id` is never true.
  In main, `s.user.id` comes from `creds.me.id` (`WAWorkerBridge.ts:127-131`), which carries a device suffix (`123:45@s.whatsapp.net`). Participant ids are either the bare PN or `@lid`. The consumer `MentionMenu.tsx:25` filters `!p.isMe`, so users see and can @-mention themselves.
  Fix: compare against `await contactService.getMeJids(s)`, which cleans the jid and includes the LID (the dependency is already `IContactNameResolver`, so widen it or pass in me-jids).

- [B-DATA-05] **low** `src/main/services/sync/SyncMessagesHandler.ts:445-450`: when a history-synced reaction has no `senderTimestampMs`, its timestamp falls back to `Date.now()/1000`.
  `ChatListEnricher.enrichSingleChat:103-107` picks the reaction as the preview whenever `reactionTs > msgTs`. After a sync, those chats show "Reacted 👍 to …" with the current time, and the displayed time moves (list order does not, because it uses `Chat.timestamp`).
  Fix: fall back to the target message's timestamp (`msgTs`, which the caller already has), or skip the reaction.

- [B-DATA-06] **low** `src/main/services/chats/sync/CommunitySyncHandler.ts:39-47` together with `SyncRepository.ts:44-65`: a community's name is only taken from `groups[rootJid]` inside the **same 25-group batch**, and `bulkUpsertCommunities` never updates existing rows.
  If a subgroup lands in an earlier batch than its root, the community is created with `name=null` and stays that way. Renames are also never picked up by hydration. The impact is limited to the `ChatListEnricher.ts:76` fallback.
  Fix: resolve names from the full `groups` map (pass it down), and update the name when it is non-null and different.

- [B-DATA-07] **low** `src/main/tests/setup.ts:52-61`: the test template DB is created with `prisma db push` whenever `template-test.db` is missing, and there is **no lock and no staleness check**.
  (a) On a clean checkout, parallel vitest workers all see the file missing and run `db push` on the same file at the same time, which makes the first run flaky.
  (b) The file is gitignored (`.gitignore:12`) and never regenerated after `schema.prisma` changes, so local runs silently test against an old schema.
  Fix: create it in vitest `globalSetup` (runs once, before workers start), keyed on a hash of `schema.prisma`.

- [B-DATA-08] **low** `src/main/tests/setup.ts:87` vs `src/main/tests/electron-mock.ts:7`: teardown deletes `prisma/test-user-data-${workerId}`, but the mock's `userData` is `prisma/test-user-data` with no worker suffix. It also resolves to `/home/user/SmartChat/prisma`, which is outside the repo.
  Media and favourites written by tests are therefore shared across parallel workers and never cleaned up.
  Fix: use the same per-worker path inside the repo in both places.

### SUSPECT (plausible, not fully proven)
- `SyncRepository.ts:306-310`: `chatMember.createMany(toInsert)` does not dedupe on `(chatJid, identityId)`. If two participants of one group resolve to the same identity (for example after an earlier wrong pushName merge), you get P2002 and the whole 25-group batch loses its memberships (caught in `GroupHydrationService.ts:38`).
- `ChatRepository.ts:251-265` together with `MessageService.ts:275-283`: a check-then-act race feeds `createMany`, and the method swallows *all* errors. One chat created concurrently makes the whole insert fail, so every other new chat in the batch is missing and the following message insert hits an FK error.
- `SyncChatsHandler.ts:151` classifies ANNOUNCE without `c.isAnnounce`, while `utils/communityUtils.ts:26` (used by ChatService and ChatSyncHandler) includes it. The same chat can get different `type` values depending on which of the three writers ran last.
- `ContactService.ts:410-423` `registerMe`: if me is found through the LID alias while a separate identity already owns `phoneNumber=myJid` without a PN alias, `updateIdentity({phoneNumber})` throws P2002 and startup self-registration fails. This needs an identity with a PN but no alias, which is rare.

---

## 2. Code quality / design issues (ranked by impact)

1. **Three independent chat writers with different semantics.** `ChatService.upsertChat` (live, `ChatService.ts:27-102`), `SyncChatsHandler.processChats` (history, `SyncChatsHandler.ts:63-133`) and `ChatSyncHandler.syncChats` (hydration, `ChatSyncHandler.ts:14-94`) each re-implement field mapping:
   - name: `name||subject` vs `c.name !== undefined` (can write null) vs truthy only
   - timestamp: inline `.low` parse at `ChatService.ts:67-74` vs `parseBaileysTimestamp`
   - community classification: `parseCommunityMetadata` vs the inline copy at `SyncChatsHandler.ts:145-178`
   - archived: three different forms

   This is the source of P2-S4-02-class bugs. There should be one `ChatUpdateNormalizer`.
2. **Duplicated identity-merge transaction.** `IdentityRepository.mergeIdentityInto` (`:49-124`) and `IdentityReconciliationService.deduplicateIdentities` (`:122-187`) are near-verbatim copies. The copy in the reconciliation service does not enrich `pushName`. `LidPnLinker` uses neither (B-DATA-01). `IdentityReconciliationService` also takes a raw `PrismaClient` (`:7`), which bypasses the repository layer it sits next to.
3. **Two participant-sync pipelines.** `GroupMembershipService.syncGroupMembers` (`:16-96`) resolves each member serially: roughly 5 awaits per member plus 3-5 statements in `ChatMemberRepository.upsertChatMember:13-52`. `MembershipSyncHandler` does the same job batched. Participant parsing, role mapping and owner/descOwner linking are copied between `GroupMembershipService.ts:28-41,90,101-120` and `MembershipSyncHandler.ts:22-67`. S4-09 is still open. In `GroupMembershipService.ts:52`, `batchGetIdentityIds` is called only for its cache side effect and its result is discarded.
4. **God method.** `MembershipSyncHandler.syncMemberships` is 250 lines in one method (`:16-269`). It resolves the same identity three times (`:124-130`, `:195-201`, `:253-259`) using three mutable maps (`aliasMap`, `pnToIdentityIdMap`, `lidMapUpserts`). B-DATA-02 exists because the three copies disagree. Extract `resolveIdentity(p)` and split the phases.
5. **Display-name logic in 4 places.** `utils/contactUtils.getDisplayName`, an identical static at `ContactNameResolver.ts:21-40`, a wrapper at `ContactService.ts:26-36`, and `ChatListEnricher.ts:85` with a *different* precedence (`displayName||pushName||verifiedName`, no `~`). The same person gets a different name in the chat list than in messages.
6. **N+1 on the chat-list hot path.** `ChatListEnricher.enrichSingleChat:94-101` runs `getIdentityIdByJid`, `findIdentityById`, `findLastMessage` and `findLastReaction` per chat. That is about 200 queries per 50-row page, plus unbounded community siblings (`:43-51`). `findLastReaction` (`ReactionRepository.ts:180`) joins through Message and orders by `Reaction.timestamp`, which has no index. The earlier tracker (S4-02) called this "performance refactor not pursued".
7. **`SyncMessagesHandler.processMessages:79` loads the entire `IdentityAlias` table** (`findAllAliases`) on every history chunk, and `historySync.ts:56` clears the caches every chunk. The cost is O(total contacts) per chunk, while `_prefetchIdentityIds` already batch-resolves exactly the needed jids. Drop the full load.
8. **Cache coherence spans two processes** (main and worker both hold a `ContactCache`). It is patched only at `wa-sync-complete` (`ContactCacheSyncSubscriber.ts`). Merges in `ContactService.upsertContact:264`, `LidPnLinker` deletes and `MembershipSyncHandler` alias re-points during live events do not invalidate the *other* process's cache. `ChatMemberRepository.ts:41-45` acknowledges the resulting stale ids ("merged?"). The cache has no TTL or eviction.
9. **Callback plumbing instead of dependencies.** `LidPnLinker.linkLidAndPn` takes `isAlreadyLinked` and `onLinked` closures (`ContactService.ts:272-284`). `ContactNameResolver` is built from `getMeJids`/`linkLidAndPn` function refs (`:12-16`) to dodge a cycle with ContactService. Inject `IContactCache` and a small `IMeJidProvider` instead.
10. **Leaky types and layering.**
    - `domain/entities.ts` hand-duplicates Prisma models. Repos return `@prisma/client` types (`ChatRepository.ts:1`, `ISyncRepository.ts:1`, `ILidMapRepository.ts:1`, `IChatMemberRepository.ts:1`) while their interfaces import `domain/entities`, so the two can drift.
    - `ChatService` mixes persistence with a live socket RPC (`getGroupParticipants:168-187`, which swallows every error to `[]`).
    - `IChatActionService` takes `sock` in every method, but 2 of 4 ignore it (`_sock`).
    - `LocalFileStorage` imports `electron.app` and uses sync fs (`readFileSync`/`copyFileSync`) on the main thread.
11. **Error swallowing.** `ChatRepository.deleteChat:271-275` (`.catch(()=>{})`, which also hides FK failures), `ChatRepository.bulkCreateChats:262-264`, `ChatMemberRepository.deleteChatMember:58-64` (any error becomes null), `ProfileSyncService.ts:164-167` (warning commented out).
12. **Chat type is inferred as `endsWith('@g.us') ? 'GROUP' : 'DM'` in 6 places** (`ChatRepository.ts:129,172,184`, `ChatMemberRepository.ts:17`, `MessageService.ts:280`, `ChatSyncHandler` default). `@newsletter`, `@broadcast` and `status@broadcast` end up typed `DM`. The chat-row `select` block is also copied 3× (`ChatRepository.ts:38-55,69-86,103-120`).
13. **Dead code.** `ChatRepository.findChats` and `deleteChat`, `ChatMemberRepository.findChatMembers`, and `LidMapRepository.findLidMaps` have 0 production callers. Also dead: the empty barrels `sync/index.ts`, `contacts/index.ts` and `storage/index.ts`, the `chats/types.ts` re-export, the unused `prismaTestClient` in `tests/setup.ts:70`, and the `ChatMember.joinedAt` column, which is never written.
14. Casts in the slice: 5 `as unknown as` / `as any` (`ChatService.ts:71-72`, `SyncMessagesHandler.ts:313,446`, `ProfileSyncService.ts:108`), plus `as ChatWithCommunity[]` / `as IdentityAliasWithIdentity[]` result casts.

### Schema (`prisma/schema.prisma`)
- **Message.id is a global `@id`** (`:139`), but the field's own doc says WA ids are "scoped per chat". Edits and revokes are keyed on id alone (`SyncMessagesHandler.ts:197,209`). A collision is rare, but an overwrite would be silent. CONTRACT-CHANGE to fix.
- **No `onDelete` anywhere except `AIChatMessage`** (`:239`). Every merge or delete must hand-order child deletes (see the merge code above and DataWipe).
- **Redundant indexes:** `Identity @@index([phoneNumber])` duplicates `@unique` (`:19,36`), `Reaction @@index([messageId])` duplicates its PK prefix (`:201-202`), and `MessageReceipt` has the same issue (`:287-288`).
- **Missing indexes:** `Reaction(senderId)`, used by merge and `countIdentityReferences` (`IdentityRepository.ts:88,130`); `Reaction(timestamp)` or `(messageId, timestamp)` for `findLastReaction`; and `Chat(pinned, timestamp)` for the `findChatsPaginated` ORDER BY (only `timestamp` is indexed, `:98`).
- **Schema drift risk.** Existing installs only receive DDL through `schema-migrations.ts:108-150`, which today covers only extension tables and one data fix. Any index or column added to `schema.prisma` reaches new installs through `template.db` but silently never reaches upgraded ones. No test compares the two.
- Magic-string enums (`Chat.type`, `IdentityAlias.type`, `ChatMember.role`) have no DB check and no shared TS union. `ChatRepository` accepts `type?: string`.

---

## 3. Test quality

**Infrastructure**
- There is one SQLite file per vitest worker, copied from the template for each file in `setupFiles`. Isolation *within* a file depends on hand-written `beforeEach` `deleteMany` chains, which are copy-pasted into all 7 repository tests (e.g. `ChatRepository.test.ts:19-27`, `SyncRepository.test.ts:19-26`). Each chain wipes a different subset of tables. `helpers.clearDatabase` exists but none of them use it, and it misses `community`, `messageVector`, `callLog` and others. Make one `resetDb(prisma)` that truncates every table from `sqlite_master`.
- Template creation has a race and a staleness problem (B-DATA-07), and the userData path does not match (B-DATA-08).
- Tests never run `runMigrations` against a Prisma-pushed DB, so template-vs-migration drift is untested.
- There are no data factories. Every test hand-builds `prisma.chat.create({data:{jid,type,...}})` and `identity.create`. The `mkChat` helper in `SyncRepository.test.ts:126` is local to that file. Add `tests/factories.ts` with `chat()`, `identity()`, `alias()`, `message()` and `groupMeta()`.

**Source files with no direct tests:** `GroupHydrationService` batch contents are only mocked. There is no real-DB test of `MembershipSyncHandler` + `SyncRepository` together. `CommunityRepository` has 2 trivial tests. `ChatRepository.deleteChat`/`searchChats(jids)`/`findChatsByJidsWithCommunity`, `IdentityRepository.mergeIdentityInto` conflict branches (member and reaction PK collisions, `:75-103`), `SyncChatsHandler.processParticipants`/`linkAccountLid`/community branch, `SyncContactsHandler.processLidPnMappings`, `SyncMessagesHandler._parseMessageProperties` (edit/revoke/stub/ciphertext, the most branchy pure function in the slice), and `domain/*` types have no coverage.

**Weak tests**
- `MembershipSyncHandler.test.ts` has one happy-path test for 270 lines of logic, with all 12 repo methods mocked. It does not cover LID-only participants (which would have caught B-DATA-02), stub creation, alias re-point, or removals.
- `IdentityReconciliationService.test.ts:12-42` mocks `prisma.*` and `$transaction` entirely. It checks that mocks are called in a transaction, not that data is merged. The real merge is a *different* copy, tested in `IdentityRepository.test.ts:112`.
- `LidPnLinker.test.ts:75-83` encodes the buggy behaviour as correct: alias moved, no delete, and no assertion about the stub's messages.
- `ContactService.test.ts` has 20+ `vi.fn()` mocks, including the cache. Assertions like `expect(cache.setMeJids).toHaveBeenCalled()` (`:96`) test wiring only. Nothing exercises `ContactService` + `LidPnLinker` + real repos except 3 milestone3 cases, and the stub merge case there has no child rows (`milestone3.test.ts:369-406`).
- `GroupMembershipService.test.ts` (2 tests) and `ChatActionService.test.ts` (4 tests) are pure `toHaveBeenCalledWith` forwarding checks. They have no error-path cases, though every method has a catch.
- `SyncChatsHandler.test.ts` and `SyncContactsHandler.test.ts` only cover regression counters.
- `GroupHydrationService.test.ts:127-153` asserts only call counts, never which groups were in each batch.
- `ChatService.test.ts` has no test for `getGroupParticipants`, which would have caught B-DATA-04.
- Good: repository tests run against real SQLite, `schema-migrations.test.ts` uses `:memory:` better-sqlite3 with real race simulation, and `SyncRepository.test.ts:132-180` covers partial failures.

---

## 4. Refactor proposal

Hotspots that limit parallelism: `ContactService.ts`, `MembershipSyncHandler.ts`, `SyncRepository.ts`/`ISyncRepository.ts`, `ChatRepository.ts`/`IChatRepository.ts`, `ServiceContainer.ts` and `workers/whatsapp/bootstrapWorkerRepositories.ts` (DI wiring for both processes), and `prisma/schema.prisma` together with `db/schema-migrations.ts`.

- [R-DATA-01] **Test DB infrastructure and factories.** Goal: a globalSetup template keyed on the schema hash, per-worker userData, a shared `resetDb()`, and `tests/factories.ts`; migrate the repository tests to use them. Files: `vitest.config.ts`, `src/main/tests/{setup.ts,helpers.ts,electron-mock.ts}`, new `src/main/tests/{globalSetup.ts,factories.ts}`, `src/main/tests/repositories/*.test.ts` (beforeEach only). Depends: none. Risk: low (test-only). Safety net: the current suite must stay green. Verify: `npx vitest run --project main` twice from a clean checkout with `rm prisma/template-test.db`, and confirm there is no `../prisma/test-user-data` outside the repo.

- [R-DATA-02] **Characterization tests for identity linking against a real DB.** Goal: pin the behaviour of `upsertContact`, `linkLidAndPn`, `mergeIdentityInto` (including PK-conflict branches) and `deduplicateIdentities` with real repos: stubs with messages, reactions and members, and conflicts. Files: new `src/main/tests/contacts/identityLinking.integration.test.ts`. Depends: R-DATA-01. Risk: low. Verify: the tests pass; B-DATA-01 is written as `it.fails` or marked todo.

- [R-DATA-03] **One merge implementation; fix B-DATA-01.** Goal: `LidPnLinker` calls `mergeIdentityInto` for orphans. `IdentityReconciliationService` delegates to `IIdentityRepository.mergeIdentityInto` and drops its `PrismaClient` dependency. Move the dedup queries into `IdentityRepository` (`findLidStubsWithPushName`, `findPnIdentitiesByPushNames`). Files: `services/contacts/{LidPnLinker,IdentityReconciliationService,IdentityRepository,IIdentityRepository}.ts`, `ServiceContainer.ts`, `workers/whatsapp/bootstrapWorkerRepositories.ts` (constructor args). Depends: R-DATA-02. Risk: med (identity data integrity). Safety net: R-DATA-02. Verify: the integration suite passes and B-DATA-01's test flips to passing; milestone3 passes.

- [R-DATA-04] **Characterization tests for MembershipSyncHandler against a real SyncRepository.** Goal: realistic `BaileysGroupMetadata` fixtures (PN groups, LID groups, LID-only owner, existing stubs, role changes, a member who left). Files: new `src/main/tests/services/chats/sync/MembershipSyncHandler.integration.test.ts`. Depends: R-DATA-01. Risk: low.

- [R-DATA-05] **Decompose MembershipSyncHandler; fix B-DATA-02 and B-DATA-03.** Goal: extract `ParticipantParser` (shared with GroupMembershipService), an `IdentityResolutionPlan` with one `resolve(p)`, and phase methods. Carry the derived PN, prune departed members per group, and dedupe `toInsert`. Files: `services/chats/sync/MembershipSyncHandler.ts`, new `services/chats/sync/ParticipantParser.ts`, `services/sync/{SyncRepository,ISyncRepository}.ts` (add `deleteMembersNotIn`). Depends: R-DATA-04. Risk: med (a wrong prune deletes real members; only prune groups whose metadata has a non-empty participants array). Verify: R-DATA-04 suite; manual full sync on a real account, then check `ChatMember` counts against WhatsApp.

- [R-DATA-06] **Route live participant sync through the batched path.** Goal: `GroupMembershipService.syncGroupMembers` reuses `ParticipantParser` and the batch resolver (fixes S4-09, removes the duplicate role/owner logic), and `linkGroupMetadataOwners` shares the parser. Files: `services/chats/{GroupMembershipService,IGroupMembershipService,ChatMemberRepository}.ts`, `tests/services/GroupMembershipService.test.ts`. Depends: R-DATA-05. Risk: med. Safety net: add a real-DB test of `group-participants.update` add/promote via the `helpers.injectEvent` registry first. Verify: main suite and the milestone tests.

- [R-DATA-07] **Single chat-update normalizer.** Goal: `normalizeChatUpdate(raw, source) → ChatUpsertData`, used by `ChatService.upsertChat`, `SyncChatsHandler`, `ChatSyncHandler` and `CommunitySyncHandler`. Unify name, timestamp, archived and classification (resolve the SUSPECT isAnnounce divergence explicitly), and add one `inferChatType(jid)` covering newsletter and broadcast. Files: new `services/chats/ChatUpdateNormalizer.ts`, `utils/communityUtils.ts`, `services/chats/{ChatService,ChatRepository,ChatMemberRepository}.ts`, `services/chats/sync/{ChatSyncHandler,CommunitySyncHandler}.ts`, `services/sync/SyncChatsHandler.ts`. Depends: none, but first add table-driven characterization tests of each writer's current output. Risk: med (it changes which fields overwrite). Verify: characterization tables; milestone2 chats.upsert/update cases.

- [R-DATA-08] **Chat-list enrichment batching.** Goal: replace per-chat queries with 3 batched queries per page (last message per chat via window or `GROUP BY`, last reaction per chat, identities for DM jids), and add a `Reaction` index. Files: `services/chats/ChatListEnricher.ts`, `services/messages/{IMessageSearchRepository,IReactionRepository}.ts` plus their implementations (add `findLastMessages(jids)` and `findLastReactions(jids)`). Depends: none; the index is CONTRACT-CHANGE (DB schema, see R-DATA-10). Risk: med (the preview output must match exactly). Safety net: a golden-output test of `getChatList` against a seeded DB built with factories. Verify: the golden test plus a query count (Prisma `$on('query')`) ≤ 5 per page.

- [R-DATA-09] **Contact cache and dependency cleanup.** Goal: inject `IContactCache` into `LidPnLinker` in place of callbacks, add a `MeJidProvider` so the `ContactNameResolver` callback cycle goes away, collapse the 3 `getDisplayName` copies into `utils/contactUtils` (fix the `ChatListEnricher.ts:85` precedence), fix B-DATA-04 via the provider, and drop `findAllAliases` from `SyncMessagesHandler`. Files: `services/contacts/{ContactService,ContactNameResolver,LidPnLinker,ILidPnLinker,ContactCache}.ts`, `services/chats/{ChatService,ChatListEnricher}.ts`, `services/sync/SyncMessagesHandler.ts`, `ServiceContainer.ts`, `workers/whatsapp/bootstrapWorkerRepositories.ts`. Depends: R-DATA-03 (both touch LidPnLinker and the wiring). Risk: med (the ContactService hotspot). Safety net: R-DATA-02 plus existing ContactNameResolver tests. Verify: main suite; in the app, the mention menu no longer lists self.

- [R-DATA-10] **Schema hygiene migration. CONTRACT-CHANGE (DB schema).** Goal: add `Reaction(senderId)`, `Reaction(messageId,timestamp)` and `Chat(pinned,timestamp)`; drop the redundant `Identity.phoneNumber`, `Reaction.messageId` and `MessageReceipt.messageId` indexes; append a matching `0003_indexes` migration entry. Add a test that compares a Prisma-pushed DB's `sqlite_master` indexes with a template+migrations DB. Files: `prisma/schema.prisma`, `src/main/db/schema-migrations.ts`, `src/main/tests/db/schema-migrations.test.ts`. Depends: R-DATA-01. Risk: low (additive indexes, `IF NOT EXISTS`). Do not change `Message.id` scoping or cascades here; those need a separate design decision. Verify: the migration test, `npm run build` regenerating the template, and an upgraded DB with `EXPLAIN QUERY PLAN` on the chat-list queries.

- [R-DATA-11] **Dead code and error-swallowing sweep.** Goal: remove `ChatRepository.findChats`/`deleteChat`, `ChatMemberRepository.findChatMembers`, `LidMapRepository.findLidMaps`, the empty barrels and the unused `prismaTestClient`. Narrow the catches in `deleteChatMember`/`bulkCreateChats` to specific Prisma codes, and have `bulkCreateChats` fall back to per-row upsert on P2002. Files: `services/chats/{ChatRepository,IChatRepository,ChatMemberRepository,IChatMemberRepository}.ts`, `services/contacts/{LidMapRepository,ILidMapRepository}.ts`, `services/{sync,contacts,storage}/index.ts`, `tests/setup.ts`. Depends: none; it conflicts textually with R-DATA-07 on ChatRepository, so sequence them. Risk: low. Verify: `npm run typecheck` and the main suite.

Suggested order: R-01 → (R-02 ∥ R-04 ∥ R-07-tests ∥ R-11) → (R-03 ∥ R-05) → (R-06 ∥ R-09 ∥ R-08) → R-10.

---

## 5. Top 5
1. **B-DATA-01 (high):** the P2-S5-01 identity-split fix was only applied to `ContactService`. `LidPnLinker.ts:54-71`, the most common linking path, still leaves the stub's messages, reactions and memberships on an alias-less identity that dedup can never collect, so the contact stays permanently split.
2. **Group membership data is wrong in two ways:** full hydration never removes departed members (B-DATA-03), and LID-only participants whose PN comes only from `LidMap` are silently dropped (B-DATA-02). Both live in a 250-line single method with one mocked test.
3. **Core write logic is duplicated and the copies already disagree:** 3 chat writers, 2 identity-merge transactions, 2 participant pipelines and 4 display-name functions. Consolidating them (R-DATA-03/05/07/09) removes the root cause of most past and present bugs in this slice.
4. **The tests mostly check wiring, not behaviour:** services are tested through `vi.fn` mocks, `IdentityReconciliationService` tests a mocked `$transaction`, and `LidPnLinker.test.ts:75` encodes the bug as correct. The test DB setup races and goes stale (B-DATA-07/08), and there are no shared factories or reset helper.
5. **Performance and schema debt:** the chat list issues about 200 queries per page, history sync loads the whole alias table on every chunk, `Reaction` and chat-list order columns have no indexes, and schema changes never reach upgraded installs unless someone hand-writes a migration (R-DATA-08/10).
