# SOLID audit — main process, preload, SDK

> Scope: `src/main/**` (excluding `src/main/tests`), `src/preload/**`, `packages/sdk/src/**`. Commit `8e0f5b8`, 2026-09-30.
> Read-only pass. It builds on `audit/{WA,MSG,DATA,AI,KRN,APP}.md` and `PLAN.md` §5. Findings that are already covered
> map to an existing `R-*` id (sometimes with a suggested scope extension). Only items marked **NEW** get a unit in §7.
> Id scheme: findings `SOLID-M-NN`, new units `R-SOLID-M-NN`.

## 0. Measurements

349 `.ts` files, 34,340 LOC. Measured with a TypeScript-AST script (functions include methods, arrows and constructors).

**Files over 300 LOC (27):** ReadMessagesTool 662 · ipcHandlers 645 · MessageService 632 · PluginHost 605 ·
MediaService 512 · sdk/channel 505 · preload/index 471 · AIService 468 · SyncMessagesHandler 455 · WAEventHandler 454 ·
ContactService 452 · ServiceContainer 444 · MessageSenderService 417 · MessageRepository 413 · main/index 401 ·
MessageQueryRepository 378 · ExecuteScriptTool 373 · MessageActionService 371 · QueryDatabaseTool 361 ·
WorkerMediaService 357 · auth 346 · sdk/context 346 · SyncRepository 327 · UIBroadcastSubscriber 318 · WAWorkerBridge 313 ·
SearchService 303 · MessageEnricher 302.

**Functions over 60 lines: 94.** The top 20:

| # | Lines | Function | Covered by |
|---|---|---|---|
| 1 | 275 | `kernel/plugins/PluginHost.ts:160` `registerBuiltin` | R-KRN-09 |
| 2 | 254 | `services/chats/sync/MembershipSyncHandler.ts:16` `syncMemberships` | R-DATA-05 |
| 3 | 235 | `ServiceContainer.ts:156` `createServices` | R-APP-07 |
| 4 | 213 | `workers/whatsapp/routing/workerCommandRouter.ts:23` `handleCommand` | R-WA-09 |
| 5 | 198 | `services/whatsapp/BaileysPatcher.ts:6` `patch` | R-WA-03 (deleted) |
| 6 | 196 | `kernel/ipc/contributionIpc.ts:45` `registerContributionIpcHandlers` | R-KRN-05, R-APP-03 (extend) |
| 7 | 195 | `workers/whatsapp/bootstrapWorkerRepositories.ts:72` | R-APP-07 (extend to worker) |
| 8 | 185 | `kernel/api-modules/KernelMessagesModule.ts:94` `handle` | NEW R-SOLID-M-02 |
| 9 | 184 | `kernel/ipc/panelIpc.ts:50` `registerPanelIpcHandlers` | R-KRN-06, R-APP-03 (extend) |
| 10 | 183 | `services/contacts/IdentityReconciliationService.ts:17` `deduplicateIdentities` | R-DATA-03 |
| 11 | 178 | `index.ts:171` (app `whenReady` closure) | R-APP-09 / D-05 |
| 12 | 164 | `kernel/KernelBootstrapper.ts:68` `boot` | R-KRN-05 |
| 13 | 163 | `kernel/api-modules/KernelAIModule.ts:41` `handle` | R-KRN-02, then NEW R-SOLID-M-02 |
| 14 | 148 | `auth.ts:199` `usePrismaAuthState` (dead) | R-APP-13 |
| 15 | 143 | `ipcHandlers.ts:416` `registerAIServiceHandlers` | R-APP-03 |
| 16 | 141 | `services/messages/MessageEnricher.ts:35` `enrichMessage` | NEW R-SOLID-M-07 |
| 17 | 139 | `services/messages/MessageSenderService.ts:278` `sendMediaMessageWorkflow` | R-MSG-09 (extend) |
| 18 | 134 | `workers/whatsapp/socket/useLocalPrismaAuthState.ts:18` | WA §2.12 (no unit; low) |
| 19 | 132 | `packages/sdk/src/channel.ts:372` `getContext` | NEW R-SOLID-M-09 |
| 20 | 129 | `workers/bridge/WAWorkerBridge.ts:90` `start` | R-WA-04/R-WA-08 |

Next ones: sdk `registerDefaultHandlers` 126, `WAEventWiringService.wire` 121 (dead, R-WA-07),
`WorkerHistorySyncManager.handleSyncChunk` 114, `DeepSeekProvider.generateResponseStream` 111 (R-AI-03),
`ExecuteScriptTool.execute` 111 (R-AI-01), `KernelChatsModule.handle` 109, `workerConnectionHandler.handleConnectionUpdate` 108.

**Constructors with more than 7 params (5):** `MessageService` 12 (`MessageService.ts:53`, R-MSG-07) ·
`MessageActionService` 10 (`:28`, NEW R-SOLID-M-14) · `MessageSenderService` 9 (`:32`, R-MSG-09) ·
`KernelMessagesModule` 9, of which 6 are optional (`:19`, NEW R-SOLID-M-02) · `WorkerConnectionHandler` 8, 7 of them closures
(`workerConnectionHandler.ts:23`, R-WA-12).

**Interfaces with 8 or more methods:** `ISyncRepository` 17 · SDK `IPluginMessagesAPI` 12, `IPluginContributionsAPI` 12 ·
`IAIChatSessionService` 11 · `IChatReadRepository` 10 · `IOverlayHost` 10 · SDK `IPluginChatsAPI` 10 · `IAIService` 9 ·
`IContactCache` 9 · `IFavoriteStickerService` 9 · SDK `IPluginUIAPI` 9 · `IMessageWriteRepository` 8 ·
`IMessageVectorRepository` 8 · `IMessageReadRepository` 8 · SDK `IPluginAIAPI` 8. The SDK ones are namespaced facades
for plugin authors, which is acceptable.

**What already works well (keep it):** message processors (`IMessageProcessorStrategy[]`), `MessageFormatterRegistry`,
`IToolRegistry`, `KernelAPIRouter.registerModule`, the `MANIFEST_TO_SLOT_MAPPINGS` table, `IWAEventSubscriber` list,
mention-enrichment strategies, and prompt protocol strategies. These are real registries. The problems below sit next to them.

## 1. SRP — single responsibility

- [SOLID-M-01] SRP `src/main/ipcHandlers.ts:1` (645 LOC, 66 handlers). One registrar for 8 domains, with side-effecting init (tool init, embedding hook).
  Fix: split into `ipc/handlers/<domain>.ts` with typed `handle<K>()`. covered by: R-APP-03 (C-02)
- [SOLID-M-02] SRP `services/messages/MessageService.ts:53` (632 LOC, 4 interfaces, 12 deps). Parse, ingest, read/enrich, reactions and media names in one class.
  Fix: `MessageReadService` + `MessageIngestService` behind a facade. covered by: R-MSG-07
- [SOLID-M-03] SRP `kernel/plugins/PluginHost.ts:160` (605 LOC). Lifecycle, builtin-context construction (275-line method), handler dispatch and manifest→slot mapping.
  Fix: `BuiltinContextFactory` from the SDK bridge, plus a `ContributionHandlerTable`. covered by: R-KRN-09
- [SOLID-M-04] SRP `services/ai/AIService.ts:19` (468 LOC). Provider registry, model routing, key masking, prompt assembly, abort bookkeeping and the tool loop.
  Fix: prompts → R-AI-06. Registry, routing and key handling → `ProviderRegistry`. covered by: R-AI-06 + **NEW** (R-SOLID-M-01)
- [SOLID-M-05] SRP `tools/ReadMessagesTool.ts:133` (662 LOC). Arg parsing, SQL guard, two query sources, chat-run grouping, name/chat lookup, reply-context rendering and date formatting.
  Fix: guard → R-AI-04. Extract a `MessageSource` (sql/jid) and a pure `TranscriptFormatter` (runs, sender labels, reply context). **NEW** (R-SOLID-M-08)
- [SOLID-M-06] SRP `services/whatsapp/WAEventHandler.ts` (454 LOC). Handles messages, contacts, LID maps, chats (mute normalisation twice), groups, presence, receipts and call synthesis.
  Fix: per-domain handlers (`MessageEventHandler`, `ChatEventHandler`, …) registered in the dispatch table (see SOLID-M-20). **NEW** (R-SOLID-M-03)
- [SOLID-M-07] SRP `services/contacts/ContactService.ts:13` (452 LOC). Identity upsert, "me" resolution (`getMeJids`, `registerMe`, `getMePhoneNumberJid`), cache warm-up, name resolution, LID lookup and a static display-name helper.
  Fix: pull out `MeIdentityProvider` and `IdentityLookup`, and delete the static. covered by: R-DATA-09 (extend: move `registerMe`/`getMe*` into the `MeJidProvider` it introduces)
- [SOLID-M-08] SRP `services/ai/AIChatSessionService.ts:9,149-195`. A Prisma session CRUD service also owns the `ai_preferences.json` file (module-load `app.getPath`, sync fs).
  **Latent defect:** on a read/parse failure `readPreferences()` returns `{autoSaveChats:true}`, and the next `setAIOptions`/`setAutoSavePreference` writes that stub over the file. This erases `externalApiToken`/`externalApiPort`, the hazard S11-02 fixed only in the second writer, `APIConfigProvider.ts:10-75`. `setAIOptions(Record<string,unknown>)` also lets the renderer overwrite `externalApiToken`.
  Fix: one `JsonPreferencesStore<T>` per file (schema, atomic write, never clobber on a parse error). **NEW** (R-SOLID-M-04)
- [SOLID-M-09] SRP `services/notification/NotificationService.ts` (249 LOC). Preferences persistence, OS login item, notification display and window focus.
  Fix: prefs through the same store, and a login-item adapter. covered by: R-APP-06 (ctor path) + **NEW** (R-SOLID-M-04)
- [SOLID-M-10] SRP `services/messages/MessageEnricher.ts:35` (141-line method). System-stub parameter rendering (LID JSON blobs), call-log lookup and contextInfo/mention enrichment are all inline.
  Fix: see OCP SOLID-M-22. **NEW** (R-SOLID-M-07)
- [SOLID-M-11] SRP `packages/sdk/src/channel.ts` (505 LOC). Transport, request/response correlation, 7 per-slot handler maps with copy-paste handlers (`:157-240`), and a 132-line `getContext` builder.
  Fix: `SdkTransport` + a generic `ContributionHandlers<slot>` + `buildContext(transport)`. **NEW** (R-SOLID-M-09)
- [SOLID-M-12] SRP `services/messages/MediaService.ts` (512) / `MessageSenderService.ts:278` (139-line media send). Download, retry/re-upload, thumbnailing, caching and path policy are mixed.
  Fix: extract `MediaReuploadRetry` and `prepare→send→persist` steps. covered by: R-MSG-09 (extend)
- [SOLID-M-13] SRP `main/index.ts` (401), `ServiceContainer.ts` (444), `KernelBootstrapper.boot` (164), `MembershipSyncHandler.syncMemberships` (254), `workerCommandRouter` (213), `UIBroadcastSubscriber` (edit merge in the IPC layer).
  covered by: R-APP-09, R-APP-07, R-KRN-05, R-DATA-05, R-WA-09, R-MSG-02

## 2. OCP — open/closed

- [SOLID-M-20] OCP `workers/whatsapp/events/workerEventDispatcher.ts:19-80`. Adding a Baileys event means another `if (events['x'])` branch here **and** a new method on the 454-line `WAEventHandler`.
  Fix: `const handlers: Partial<{[K in keyof BaileysEventMap]: (p, sock) => Promise<void>}>`, iterated in a fixed order (order matters: history before upsert). **NEW** (R-SOLID-M-03)
- [SOLID-M-21] OCP `services/ai/AIService.ts:28-39,82-100`. Providers are `new`ed in the constructor, and `normalizeModelId` is an if-chain of prefixes (`gemini-`, `llama-`, `openai/gpt-oss-120b`, …) that duplicates each provider's `canHandleModel`. A new provider means editing AIService twice.
  Fix: providers are injected as `ProviderRegistration {key, legacyPrefixes, factory}`, and routing is derived from the list. **NEW** (R-SOLID-M-01)
- [SOLID-M-22] OCP `services/messages/MessageEnricher.ts:49,144`. Type-specific enrichment is an if-chain on `messageType` (`system`, `call`/`callLogMesssage`/`scheduledCallCreationMessage`). The same type list is spelled again in the renderer (`MessageItem.tsx:202`, `SystemMessage.tsx:23`).
  Fix: `IMessageTypeEnricher[]` (like formatters) plus a shared `CALL_MESSAGE_TYPES` const. **NEW** (R-SOLID-M-07)
- [SOLID-M-23] OCP `kernel/api-modules/Kernel{Messages,UI,Chats,AI,Contacts}Module.ts`. Each `handle()` is a `switch(action)` with 6-12 cases, and the capability/scope check is written inline per case. A new SDK method means a new case, and the permission policy can't be audited in one place.
  Fix: `BaseKernelModule.actions: Record<action, {capability, scope?: (p)=>jid, run}>`, with the base class enforcing capability and scope before `run`. **NEW** (R-SOLID-M-02)
- [SOLID-M-24] OCP adding a contribution slot touches `ContributionPoints.ts`, `MANIFEST_TO_SLOT_MAPPINGS` (`PluginHost.ts:36`), a hand-written `register*` in the builtin context (`PluginHost.ts:350-420`), SDK `IPluginContributionsAPI`, SDK `channel.ts:157-240`, two manifest schemas and the renderer.
  Fix: one `SlotDescriptor` table shared by kernel and SDK. covered by: R-KRN-09 + R-KRN-10 + R-KRN-11 (extend: make the descriptor table the deliverable)
- [SOLID-M-25] OCP adding an IPC channel touches preload, `index.d.ts`, `IAPIService`, `api.service` and the mock. covered by: R-APP-02/03/04 (C-01..C-03)
- [SOLID-M-26] OCP worker command `switch` (12 cases) and the bridge's hard-coded forward/sock-injection allow-lists. covered by: R-WA-09, R-WA-08
- [SOLID-M-27] OCP `services/ai/AIToolInitializer.ts:17-41`. The tool list is hard-coded, and ExecuteScriptTool depends on registration order ("must be instantiated last").
  Fix: move the list into the AI composition factory; ExecuteScriptTool resolves tools lazily at execute time. covered by: R-APP-07 (list) + R-AI-01 (ordering)

## 3. LSP — substitutability and contracts

- [SOLID-M-30] LSP `services/ai/AIService.ts:292-360`. It dispatches on `'generateResponse' in provider` / `'generateResponseStream' in provider`, yet all 5 providers implement both interfaces, so the split `IStreamingProvider`/`IFullResponseProvider` buys nothing. `IApiKeyAwareProvider` is detected with an `as any` probe (`:67`), and `providers/Provider.ts` (`AIProvider`) is dead.
  Providers also accept the abort signal two ways (`options.signal` wins over the `signal` param: `GeminiProvider.ts:66,97`, `LMStudioProvider.ts:107,172`). The contract is ambiguous, and B-AI-06 grew from it.
  Fix: a single `AIProvider` interface with a required `stream()` (full = collect), one `signal` param, and `supportsApiKey` as data. **NEW** (R-SOLID-M-01; after R-AI-03)
- [SOLID-M-31] LSP `kernel/api-modules/KernelMessagesModule.ts:19-28,206,248,259`. 6 optional constructor deps. When one is missing, a supported SDK call fails at runtime with `INTERNAL_ERROR 'X is not available'`, so a module built one way doesn't substitute for one built the other way.
  Fix: required deps; tests pass fakes. **NEW** (R-SOLID-M-02)
- [SOLID-M-32] LSP `services/chats/IChatActionService.ts:8-9`, `SearchService.ts:111,148`, `secret/MessageEditStrategy.ts:22`. The interface requires a `sock` that implementations ignore (`_sock`), so callers must obtain a socket for nothing, and a "socket-less" fake is indistinguishable.
  Fix: drop the param from those methods. **NEW** (R-SOLID-M-10)
- [SOLID-M-33] LSP `services/messages/IMediaService.ts:5` `updateMediaMessage?: (msg:any)=>Promise<any>`. It is optional in the port, but `MediaService.ts:418` throws "not supported by the current socket context" (also `WorkerMediaService.ts:304`). Separately, `WASocket` in `services/whatsapp/types/socket.types.ts` is the bridge proxy shape but shares its name with Baileys' `WASocket` (WA §2.9), so substitutability is decided by casts.
  Fix: a required `IMediaReuploadSocket` role, and rename the proxy type `WorkerSocketProxy`. **NEW** (R-SOLID-M-10)
- [SOLID-M-34] LSP `services/messages/MessageRepository.ts:107-110` `upsertMessage` returns a fabricated "saved" row on failure. `insertNewMessages:273`, `updateExistingMessages:318`, `editMessage:217` and `ReactionRepository.upsertReaction:46` swallow errors, and `AuthStateRepository.deleteValue:50-56` swallows while its `get`/`set` siblings rethrow. Callers cannot rely on the port's postcondition (MSG §2.9, APP §2.7; no unit owns them).
  Fix: throw, or return `Result`. The behaviour change goes in a fix commit with a failing test first. **NEW** (R-SOLID-M-13)
- [SOLID-M-35] LSP `kernel/channels/DirectPluginChannel.ts:46-80` vs `WorkerPluginChannel`. A destroyed channel *resolves* `{ok:false}` while a timeout *rejects*, and one pending map serves both directions. covered by: R-KRN-04 (KRN §2.5/2.7)
- [SOLID-M-36] LSP builtin `showOverlay().on()` is a no-op stub (`PluginHost.ts:304`); SDK `importAPI` always returns NOT_FOUND; `message-send-pipeline` expects a `next` function that can't cross `postMessage`. covered by: R-KRN-09, R-KRN-11
- [SOLID-M-37] LSP test fakes: `$transaction` is mocked so repo fakes don't honour atomicity, and the global `EmbeddingService` mock stands in for every consumer. covered by: N-01/R-DATA-01, R-APP-12

## 4. ISP — interface segregation

- [SOLID-M-40] ISP `services/sync/ISyncRepository.ts:41` (17 methods). Three consumers use disjoint slices: `CommunitySyncHandler` 2, `ChatSyncHandler` 3, `MembershipSyncHandler` 12. `bulkCreateChats` is also called by `MessageService`, and `createIdentity`/`findIdentityAliases` by `ContactService`, `LidPnLinker`, `ContactNameResolver` and `ReadMessagesTool`.
  Fix: `ICommunitySyncRepo`, `IChatSyncRepo` and `IMembershipSyncRepo` (`SyncRepository` implements all three), with each handler typed on its role. **NEW** (R-SOLID-M-06)
- [SOLID-M-41] ISP `ServiceContainer` (47 entries) passed whole to 4 consumers. `SubscriberServices` (15 fields, `subscribers/index.ts:40`) is a second bag: each subscriber takes 1-4 of them. covered by: R-APP-08 (extend to `SubscriberServices`)
- [SOLID-M-42] ISP `services/ai/IAIChatSessionService.ts:14` (11 methods) = 7 session methods (all `Promise<any>`) + 4 preference methods. IPC session handlers and the settings panel use disjoint halves.
  Fix: `IAIChatSessionStore` + `IAIPreferences`. **NEW** (R-SOLID-M-04); typing covered by: R-AI-05
- [SOLID-M-43] ISP `services/messages/IMessageActionService` mixes delete/edit/forward/react with `sendMessageWorkflow`/`sendMediaMessageWorkflow`, which are pure passthroughs to `IMessageSenderService` (`MessageActionService.ts:347-371`). That passthrough is why the constructor has 10 deps; SendMessageTool and the kernel go through the wrong role.
  Fix: callers take `IMessageSenderService` directly and the passthroughs are deleted. **NEW** (R-SOLID-M-14)
- [SOLID-M-44] ISP `workers/whatsapp/IWorkerBootstrap.ts:3-12` exposes concrete classes (`WAEventHandler`, `ContactService`, `ChatService`, `MessageService`, `ChatMemberRepository`, `AuthSettingsService`, …). The router and dispatcher get the whole graph; the router types repos as `any` (WA §2.9).
  Fix: role interfaces per consumer (`WorkerCommandDeps`, `WorkerEventDeps`). **NEW** (R-SOLID-M-11)
- [SOLID-M-45] ISP `IMessageServiceDependencyAccessor` hands processors a concrete `SecretMessageService` (`processors/IMessageProcessorStrategy.ts:7,28`). covered by: R-MSG-07 (MSG §2.6)

## 5. DIP — dependency inversion

- [SOLID-M-50] DIP 7 services read `app.getPath('userData')`, several at **module load**: `AIChatSessionService.ts:9`, `NotificationService.ts:11`, `AIChatExportService.ts:22`, `FSKeyStorage.ts:10`, `LocalFileStorage.ts`, `KernelBootstrapper.ts:77`, `index.ts:266`. Five JSON files are written by ad-hoc sync fs code.
  Fix: inject `AppEnv.userDataPath` plus `JsonPreferencesStore`. covered by: R-APP-06 (container, NotificationService) + **NEW** (R-SOLID-M-04 for the AI/key/export stores)
- [SOLID-M-51] DIP services push to the renderer via `BrowserWindow` directly: `UIBroadcastSubscriber.ts:12,61`, `WhatsAppConnectionManager.ts:1,17,70`, `KernelUIModule.ts:1,71`, `NotificationService.ts:1`, `KernelBootstrapper.ts:1`, plus `ipcHandlers.ts:243,392,423,443` (4 ways to pick "the" window).
  Fix: an `IRendererNotifier {send<K extends EventMap>(ch, payload)}` port typed by the C-01 `EventMap`, with one electron adapter. **NEW** (R-SOLID-M-05)
- [SOLID-M-52] DIP services that take a raw `PrismaClient` beside a repository layer: `AIChatSessionService`, `CitationSessionManager.ts:1`, `SecretMessageService.ts:2,94` (a single `message.findUnique`), `FavoriteStickerService.ts:55-259`, `IdentityReconciliationService.ts:1`, `DataWipeService`.
  Fix: `SecretMessageService` → `IMessageReadRepository`; AI sessions/citations → `AIChatRepository`. covered by: R-DATA-03 (IdentityReconciliation), R-WA-12 (DataWipe), R-MSG-09 (FavoriteSticker) + **NEW** (R-SOLID-M-12 for the rest)
- [SOLID-M-53] DIP `tools/QueryDatabaseTool.ts:4` imports the `prisma` singleton from `auth.ts`. covered by: R-APP-13 / D-04
- [SOLID-M-54] DIP `new` of collaborators inside services: `AIService` providers (`:34-38`, NEW R-SOLID-M-01) · `NotificationService.ts:26` `new ElectronNotificationProvider()` (R-APP-06 extend) · `MessageSenderService.ts:43` `fileStorage ?? new LocalFileStorage()` (R-MSG-09) · `KernelBootstrapper.ts:82` `new PermissionStore(path)` (R-KRN-05/R-APP-08) · module singletons `audioTranscoderService`/`stickerMetadataService` (R-APP-06, R-MSG-09).
- [SOLID-M-55] DIP domain services import `electron` for paths (`MediaService`, `FavoriteStickerService`, `StickerMetadataService`), which is why worker shadow classes exist. covered by: R-MSG-09
- [SOLID-M-56] DIP Baileys wire types leak into the domain: 26 non-worker files import `@whiskeysockets/baileys`, including `MessageService`, `MessageParser`, `MessageSenderService`, `ReadMessagesTool`, `messageUtils` and `domain/whatsapp.types.ts`. Stored content is `Record<string,unknown>` with ~170 `as` casts (MSG §2.13), so a Baileys upgrade ripples through services.
  Fix: a typed `StoredMessageContent` domain model plus an adapter at ingest; services depend on the domain type. **NEW** (R-SOLID-M-15)
- [SOLID-M-57] DIP cross-module concrete imports: `ContactNameResolver` (static `getDisplayName`) from `ChatListEnricher.ts:7` and `MessageEnricher.ts:1`; `MessageFormatterRegistry` concrete in `NotificationService.ts:8`, `ChatListEnricher.ts:2`, `ReadMessagesTool.ts:9`; `SecretMessageService` in `MessageService.ts:5`. covered by: R-MSG-10 (display name), R-MSG-07 (secret); formatter registry: trivial `IMessageFormatterRegistry`, fold into R-SOLID-M-08
- [SOLID-M-58] DIP `WorkerConnectionHandler` ctor takes 7 closures over mutable connection state (`getIsFreshLogin`/`setIsFreshLogin`, `onReconnect`, …). covered by: R-WA-12 (make it a `ConnectionSession` state object)
- [SOLID-M-59] DIP `WhatsAppConnectionManager`, `AIToolInitializer` and `KernelBootstrapper` take the whole `ServiceContainer`; the tools take `getSock` plus concrete services. covered by: R-APP-08

## 6. Hotspot notes for new units
`AIService.ts` (R-AI-03/05/06) · `Kernel*Module.ts` (S-03, S-04, R-KRN-02/07) · `WAEventHandler.ts` (R-MSG-03/08/10) ·
`MessageActionService.ts` (F-MSG-1/R-MSG-02, R-MSG-06, R-KRN-07) · `ServiceContainer.ts`/`bootstrapWorkerRepositories.ts` (DI lock) ·
`MessageRepository.ts` (MSGREPO lock) · `sdk/channel.ts` (R-KRN-04/11) · `AIChatSessionService.ts` (R-AI-05) · `ipcHandlers.ts` (IPC lock).
Every new unit below is scheduled **after** the existing units that own the same files, so it only needs a rebase.

## 7. New refactor units (NEW items only)

- [R-SOLID-M-01] **AI provider registry and single provider contract** — Goal: providers are injected as
  `ProviderRegistration{key, legacyPrefixes, create}`; `normalizeModelId` and the fallback are derived from the list.
  One `AIProvider` interface (required `stream`, full = collect, a single `signal` param) and `supportsApiKey`/`updateApiKey`
  as typed members. Delete `Provider.ts`, the `'in'` probes and the `as any`. Covers SOLID-M-04 (registry part), M-21, M-30, M-54 (AI).
  Files: `services/ai/AIService.ts`, `services/ai/providers/{IBaseAIProvider,IStreamingProvider,IFullResponseProvider,IApiKeyAwareProvider,Provider}.ts`,
  new `services/ai/providers/providerRegistry.ts`, `ServiceContainer.ts` (ctor only). Depends on: R-AI-03, R-AI-06, F-AI-3.
  Risk: M (model routing for legacy ids). Safety net: a table test of `normalizeModelId` over every legacy id plus the provider
  selection tests from N-09. Verify: typecheck, `vitest src/main/tests/services/ai`, pick each provider in the UI 🔎.
  Hotspot: AIService.ts.
- [R-SOLID-M-02] **Declarative kernel module actions** — Goal: `BaseKernelModule` gains
  `actions: Record<string,{capability; scope?(payload):Promise<string|null>; run(pluginId,payload)}>`; the base class enforces
  capability and scope before `run` and returns NOT_FOUND for unknown actions. Convert the Messages, Chats, Contacts, UI and AI modules.
  Required constructor deps (no optional ones) so they substitute cleanly. Add a generated capability table test (action → capability) that
  doubles as a security snapshot. Covers M-23, M-31. Files: `kernel/api-modules/*.ts`, `KernelBootstrapper.ts` (ctor args only).
  Depends on: S-03, S-04, R-KRN-02, R-KRN-07. Risk: M (permission semantics; pure move). Safety net: existing kernel module
  tests plus N-06 `createTestKernel`; the snapshot must equal the pre-refactor capability per action.
  Verify: vitest kernel, and the sample plugins still work. Hotspot: KHOST (bootstrapper line only).
- [R-SOLID-M-03] **WA event dispatch table + split WAEventHandler** — Goal: `workerEventDispatcher` iterates an ordered
  `EventHandlerTable` keyed by Baileys event; `WAEventHandler` is split into `MessageEventHandler`, `ChatEventHandler`
  (one mute normaliser), `ContactEventHandler`, `GroupEventHandler` and `PresenceReceiptHandler`, each registering its keys. Covers M-06, M-20.
  Files: `workers/whatsapp/events/workerEventDispatcher.ts`, `services/whatsapp/WAEventHandler.ts` → `services/whatsapp/handlers/*.ts`,
  `bootstrapWorkerRepositories.ts` (wiring). Depends on: N-02, R-MSG-03, R-MSG-08, R-MSG-10, R-WA-08. Risk: M (event
  order: history before upsert, connection first). Safety net: N-02 contract tests plus a new order test (a table-driven
  dispatcher called with a multi-event batch records the handler order). Verify: vitest WA, and a live login syncs 🔎. Hotspot: DI (wiring).
- [R-SOLID-M-04] **Preferences store port + fix the ai_preferences clobber** — Goal: `JsonPreferencesStore<T>(path, schema, defaults)`
  with atomic write, merge-on-write, and *no write when the on-disk file failed to parse*. Used by `AIChatSessionService`
  (moved into a new `AIPreferencesService` implementing `IAIPreferences`), `APIConfigProvider`, `NotificationService` prefs,
  `FSKeyStorage` and `AIChatExportService`, all taking `userDataPath` via injection. `set-ai-options` whitelists keys, so the renderer
  can no longer write `externalApiToken`. Covers M-08, M-09, M-42 (split), M-50.
  Order: failing tests first (a corrupt file followed by `setAIOptions` must keep the token; `setAIOptions({externalApiToken})` must be ignored), then the fix, then the refactor commit.
  Files: `services/ai/{AIChatSessionService,IAIChatSessionService,AIChatExportService,FSKeyStorage}.ts`, `services/apiServer/APIConfigProvider.ts`,
  `services/notification/NotificationService.ts`, new `services/storage/JsonPreferencesStore.ts`, `ServiceContainer.ts` (ctor).
  Depends on: R-APP-06, R-AI-05. Risk: M (user settings files). Safety net: tests on real temp dirs. Verify: settings survive a restart and the API token is stable 🔎.
- [R-SOLID-M-05] **Renderer notifier port** — Goal: `IRendererNotifier.send<K extends keyof EventMap>(channel, payload)`
  plus `focusMain()`, with one electron adapter that owns window selection. Replace direct `BrowserWindow` use in `UIBroadcastSubscriber`,
  `WhatsAppConnectionManager`, `KernelUIModule`, `NotificationService`, `KernelBootstrapper` and the 4 `ipcHandlers` sites. Covers M-51.
  Files: those files plus new `main/app/RendererNotifier.ts`. Depends on: C-01 (EventMap), C-04 (orphan events), D-03. Risk: L-M.
  Safety net: N-05 recording ipc mock; the notifier fake asserts channel + payload. Verify: toasts, QR and sync progress still reach the UI 🔎.
  Hotspot: IPC, DI, KHOST (one line each). Schedule last in Wave 4.
- [R-SOLID-M-06] **Segregate ISyncRepository** — Goal: `ICommunitySyncRepository`, `IChatSyncRepository` and
  `IMembershipSyncRepository`; each handler (and `MessageService`, `ContactService`, `LidPnLinker`, `ContactNameResolver`,
  `ReadMessagesTool`) is typed on the role it uses. Types only. Covers M-40. Files: `services/sync/ISyncRepository.ts`,
  `services/chats/sync/{Community,Chat,Membership}SyncHandler.ts`, consumer ctor types. Depends on: R-DATA-05, R-DATA-07.
  Risk: L. Safety net: typecheck plus N-04. Verify: typecheck, vitest DATA.
- [R-SOLID-M-07] **Message-type enrichment strategies** — Goal: `IMessageTypeEnricher{supports(msg); enrich(msg, content, ctx)}`
  with `SystemStubEnricher` (LID JSON blob naming) and `CallLogEnricher`; `MessageEnricher.enrichMessage` becomes parse →
  strategy → contextInfo. A shared `CALL_MESSAGE_TYPES` in `src/shared` (the renderer adopts it later). Covers M-10, M-22.
  Files: `services/messages/MessageEnricher.ts`, new `services/messages/enrichers/*.ts`. Depends on: R-MSG-07. Risk: L.
  Safety net: characterization tests on real rows for a system stub with a LID blob, numeric PN, a group subject, and a call log with a base64/ascii callKey.
  Verify: vitest MSG.
- [R-SOLID-M-08] **Split ReadMessagesTool** — Goal: `MessageSource` (sql | jid, using the R-AI-04 guard) plus a pure
  `TranscriptFormatter` (runs, sender labels, reply context, dates) plus a thin tool. It depends on `IMessageFormatterRegistry`
  (add the interface). Covers M-05, M-57 (formatter). Files: `tools/ReadMessagesTool.ts`, new `tools/readMessages/*.ts`,
  `services/messages/formatters/MessageFormatterRegistry.ts` (interface). Depends on: R-AI-04, F-MSG-1. Risk: L.
  Safety net: golden-output tests of the transcript on a seeded DB before the split. Verify: vitest AI tools.
- [R-SOLID-M-09] **SDK channel decomposition** — Goal: `SdkTransport` (correlation, timeouts, error mapping), a generic
  `ContributionHandlerMap<Slot>` replacing 7 copy-paste handlers, and `buildPluginContext(transport)` out of the 132-line `getContext`.
  No API change. Covers M-11. Files: `packages/sdk/src/channel.ts` → `packages/sdk/src/{transport,contributions,context-builder}.ts`.
  Depends on: R-KRN-04, R-KRN-11. Risk: M (plugin runtime). Safety net: N-06 real-worker fixture plus the SDK tests; all 4 sample plugins load.
  Verify: vitest sdk + kernel e2e.
- [R-SOLID-M-10] **Honest socket ports** — Goal: remove the ignored `_sock` params (`IChatActionService.markChatRead/archiveChat`,
  `SearchService`, `MessageEditStrategy`); add a required `IMediaReuploadSocket` role (no optional `updateMediaMessage` plus a runtime
  throw); rename the bridge `WASocket` to `WorkerSocketProxy`. Covers M-32, M-33. Files: `services/chats/{IChatActionService,ChatActionService}.ts`,
  `services/search/SearchService.ts`, `secret/MessageEditStrategy.ts`, `services/messages/IMediaService.ts`, `MediaService.ts`,
  `services/whatsapp/types/socket.types.ts`, plus call sites (tools, ipc, kernel). Depends on: R-MSG-09, C-02. Risk: L (types).
  Safety net: typecheck plus the existing tests. Verify: typecheck, vitest.
- [R-SOLID-M-11] **Worker bootstrap role interfaces** — Goal: `IWorkerBootstrap` exposes interfaces only, split into
  `WorkerCommandDeps` (router) and `WorkerEventDeps` (dispatcher); the router's `any` repos go away. Covers M-44.
  Files: `workers/whatsapp/IWorkerBootstrap.ts`, `bootstrapWorkerRepositories.ts`, `routing/*`, `events/workerEventDispatcher.ts`.
  Depends on: R-WA-09, R-MSG-07, R-SOLID-M-03. Risk: L. Safety net: N-02 contract tests. Verify: typecheck, vitest WA. Hotspot: DI, WABRIDGE (router).
- [R-SOLID-M-12] **Repositories for the remaining raw-Prisma services** — Goal: `SecretMessageService` uses
  `IMessageReadRepository`; `AIChatSessionService` and `CitationSessionManager` go through a new `AIChatRepository`/`CitationRepository`.
  Covers M-52 (rest). Files: `services/whatsapp/secret/SecretMessageService.ts`, `services/ai/AIChatSessionService.ts`,
  `services/ai/citations/CitationSessionManager.ts`, new `services/ai/repositories/*.ts`, `ServiceContainer.ts` (ctor).
  Depends on: R-AI-05, R-WA-11, R-SOLID-M-04. Risk: L. Safety net: real-DB repo tests (N-01). Verify: vitest AI, WA.
- [R-SOLID-M-13] **Honest write contracts (fix)** — Goal: `MessageRepository.upsertMessage` stops fabricating a saved row;
  `insertNewMessages`, `updateExistingMessages`, `editMessage`, `decryptMessage` and `ReactionRepository.upsertReaction` throw
  (or return `Result`), and callers decide; `AuthStateRepository.deleteValue` matches `get`/`set`. Behaviour change: tests go `it.fails` first.
  Covers M-34. Files: `services/messages/{MessageRepository,ReactionRepository}.ts`, `services/auth/AuthStateRepository.ts`,
  and their callers' catch sites. Depends on: F-MSG-3, F-MSG-4, H-02. Risk: M (errors now surface on ingest paths). Safety net: N-03 plus
  new failure-injection tests. Verify: vitest; a history sync doesn't abort on a single bad row 🔎. Hotspot: MSGREPO.
- [R-SOLID-M-14] **Drop MessageActionService send passthroughs** — Goal: `SendMessageTool`, `KernelMessagesModule`, ipc
  and APIServer depend on `IMessageSenderService` for sending; delete `sendMessageWorkflow`/`sendMediaMessageWorkflow` from
  `IMessageActionService`, which cuts the constructor to ≤8. Covers M-43. Files: `services/messages/{MessageActionService,IMessageActionService}.ts`,
  `tools/SendMessageTool.ts`, callers. Depends on: F-MSG-1, R-MSG-06, R-KRN-07, C-02. Risk: L. Safety net: existing send tests.
  Verify: send from UI, AI tool and plugin 🔎.
- [R-SOLID-M-15] **Typed stored-message content (domain model)** — Goal: `domain/StoredMessageContent` (discriminated
  union for the ~12 kinds the app renders) plus a Baileys→domain adapter at ingest (`MessageParser`/`SyncMessagesHandler`);
  read-side services (`MessageEnricher`, `ReadMessagesTool`, formatters) stop importing Baileys. Incremental: read side first. Covers M-56.
  Files: new `src/main/domain/messageContent.ts`, `services/messages/{MessageParser,MessageEnricher}.ts`, `formatters/*`,
  `utils/messageUtils.ts`. Depends on: R-MSG-08, R-SOLID-M-07, R-SOLID-M-08. Risk: M (wide, types only). Safety net: parser
  golden tests over the fixture corpus. Verify: typecheck and the `as` count drops. Wave 5. Hotspot: MSGREPO (messageUtils).

## 8. Scorecard

| Principle | Severity | Summary |
|---|---|---|
| SRP | high | 27 files >300 LOC, 94 functions >60 lines. The worst (ipcHandlers, MessageService, PluginHost, MembershipSync) are already planned; new: WAEventHandler, ReadMessagesTool, SDK channel, and prefs-in-session-service, which hides a token-clobber defect. |
| OCP | med | Good registries exist (processors, formatters, tools, kernel router), but WA event dispatch, AI provider routing, kernel module `switch`es, message-type enrichment and contribution slots still need edits in several places. |
| LSP | med | Duck-typed AI provider dispatch with ambiguous abort contract, optional deps/methods that throw at runtime, ignored `_sock` params, and repositories that fabricate success. |
| ISP | med | `ServiceContainer` (47) and `SubscriberServices` bags, `ISyncRepository` (17 methods, 3 disjoint consumers), `IAIChatSessionService` (sessions + prefs), `IMessageActionService` send passthroughs, and concrete `IWorkerBootstrap`. |
| DIP | high | Electron `app`/`BrowserWindow` in ~15 services (module-load paths), raw Prisma in 6 services plus a singleton import, providers `new`ed in AIService, and Baileys wire types throughout the domain. |
