# Refactor Audit — SmartChat

## Phase Tracker
- [x] Phase 1: Renderer Type Segregation
- [x] Phase 2: Utility Extraction from Interface Files
- [x] Phase 3: Renderer API Abstraction
- [x] Phase 4: Message Repository Interface Cleanup
- [x] Phase 5: Embedding Service Decoupling
- [x] Phase 6: DI Container — Wire AIToolService Singleton
- [x] Phase 7: IChatService Transport Decoupling
- [x] Phase 8: AI Provider Interface Segregation
- [x] Phase 9: SystemPromptBuilder Restructuring

---

## Per-File Violation Report

---

## `src/main/services/whatsapp/types.ts`
Fan-in: 1 (highest — imported by virtually all WA-layer files)

**Responsibilities**
1. Re-exports all types from `../../domain/whatsapp.types` (barrel)
2. Defines `WASocket` and `SocketAccessor` — Baileys transport aliases
3. Defines Baileys protocol/event payload shapes (`ProtocolResult`, `BaileysMessage`, `MediaSendOptions`, `MessageReceiptUpdate`, `BaileysReactionUpdate`, `WASocketWithSignalRepository`)

**SOLID Evaluation**
| Principle | Result | Notes |
|---|---|---|
| SRP | PASS | All types belong to the WA transport boundary |
| OCP | N/A | Type definitions only |
| LSP | N/A | No inheritance |
| ISP | PASS | Consumers import only what they need |
| DIP | PASS | No concrete instantiation |

> **No violations.** This file is a well-scoped transport-layer type barrel.

**Effort: N/A**

---

## `src/renderer/src/types.ts`
Fan-in: 2 (imported by api.service, component files across the renderer)

**Responsibilities**
1. Defines chat/message/search UI domain data shapes (`ChatItem`, `MessageItem`, `SearchResultItem`, `SearchResults`, etc.)
2. Defines AI domain types (`ModelInfo`, `AIChatOptions`, `AIChatMessage`, `AIChatSessionItem`, `AIContextItem`)
3. Defines rich media message content structures (`ImageMessageContent`, `VideoMessageContent`, `AudioMessageContent`, etc.) — these are raw protocol shapes, not UI types
4. Defines UI component prop interfaces (`ImageMessageProps`, `VideoMessageProps`, `AudioMessageProps`, `TemplateMessageProps`, etc.)
5. Exports a runtime utility function `isJPEGThumbnailBuffer` — a type guard, not a type definition
6. Defines notification preferences (`NotificationPreferences`)

**SOLID Evaluation**
| Principle | Result | Notes |
|---|---|---|
| SRP | VIOLATION | File has 6 distinct responsibilities across 370 lines |
| OCP | N/A | Type definitions |
| LSP | N/A | No inheritance |
| ISP | VIOLATION | Components importing `ChatItem` are forced to depend on `AudioMessageProps`, `TemplateMessageProps`, etc. |
| DIP | N/A | No instantiation |

**Violations**

### SRP — Monolithic type barrel mixing domain, protocol, UI props, and runtime logic
Symptom: The file contains domain data shapes, raw Baileys protocol shapes (e.g. `RawMessageContent`, `ContextInfo`, `HydratedTemplate`), React component prop interfaces, and a runtime function (`isJPEGThumbnailBuffer`). Each layer has a different reason to change.
Fix: Split into four files: `chatTypes.ts` (chat/message/search domain shapes), `aiTypes.ts` (AI session/chat types), `mediaTypes.ts` (raw protocol/content shapes and the `isJPEGThumbnailBuffer` guard), `componentProps.ts` (UI component prop interfaces). `NotificationPreferences` belongs in a `settingsTypes.ts` or co-located with the settings feature.
Effort: Low

### ISP — Single import file forces unrelated type dependencies on all consumers
Symptom: A component rendering only chat items (`ChatItem`) imports from this file and transitively depends on `AudioMessageProps`, `TemplateMessageProps`, `HydratedButton`, `InteractiveMessageTemplate`, etc. — types it will never use.
Fix: The split described under SRP above resolves this automatically — each consumer imports from the specific sub-file it needs.
Effort: Low

---

## `src/main/utils.ts`
Fan-in: 3 (imported by many main-process files as a convenience re-export)

**Responsibilities**
1. Re-exports `cleanJid` from `./utils/jidUtils`
2. Re-exports message utility functions from `./utils/messageUtils`
3. Re-exports `parseCommunityMetadata` from `./utils/communityUtils`

**SOLID Evaluation**
| Principle | Result | Notes |
|---|---|---|
| SRP | PASS | Pure barrel — no logic of its own |
| OCP | N/A | |
| LSP | N/A | |
| ISP | PASS | Consumers can import selectively |
| DIP | PASS | No instantiation |

> **No violations.** This is a thin convenience barrel over three well-scoped utility modules.

**Effort: N/A**

---

## `src/main/services/contacts/IContactService.ts`
Fan-in: 4 (imported by ContactService, ServiceContainer, MessageEnricher, and several IPC handlers)

**Responsibilities**
1. Defines `IContactQueryService` interface (read operations)
2. Defines `IContactMutationService` interface (write/link operations)
3. Defines `IContactNameResolver` interface (name resolution)
4. Defines `IContactCacheManager` interface (cache lifecycle)
5. Defines composite `IContactService` extending all four
6. **Exports concrete runtime function `getDisplayName`** — a utility that belongs in a helper module, not an interface file

**SOLID Evaluation**
| Principle | Result | Notes |
|---|---|---|
| SRP | VIOLATION | Interface definition file exports a concrete runtime function |
| OCP | N/A | |
| LSP | N/A | |
| ISP | PASS | Sub-interfaces are well-segregated; consumers can depend on `IContactQueryService` alone |
| DIP | N/A | |

**Violations**

### SRP — Concrete utility function exported from an interface file
Symptom: `getDisplayName(identity, fallback)` is a pure formatting utility that lives in `IContactService.ts`. Interface files should contain only type contracts. Having executable logic here means this file changes both when the contact interface contract changes AND when the display-name formatting logic changes.
Fix: Move `getDisplayName` to `src/main/utils/contactUtils.ts` (or co-locate with `ContactNameResolver`). The interface file should export only the four sub-interfaces and the composite `IContactService`.
Effort: Low

---

## `src/main/domain/types.ts`
Fan-in: 5 (imported by nearly all repository interfaces and services)

**Responsibilities**
1. Defines core persistence-layer entity shapes: `DBMessageWithSender`, `ProcessedMessage`, `MessageUpsertData`, `Chat`, `Community`, `Identity`, `IdentityAlias`, `Message`, `Reaction`

**SOLID Evaluation**
| Principle | Result | Notes |
|---|---|---|
| SRP | PASS | Single concern: domain entity definitions |
| OCP | N/A | Type definitions |
| LSP | N/A | No inheritance |
| ISP | PASS | Small file; all types belong to the persistence domain |
| DIP | N/A | No instantiation |

> **No violations.** Well-scoped domain entity file.

**Effort: N/A**

---

## `src/renderer/src/context/APIContext.tsx`
Fan-in: 6 (used by all renderer components via `useAPI()`)

**Responsibilities**
1. Creates and exposes a React context holding the `api` singleton
2. Provides `APIProvider` wrapper component
3. Provides `useAPI` hook

**SOLID Evaluation**
| Principle | Result | Notes |
|---|---|---|
| SRP | PASS | Single concern: dependency injection via React context |
| OCP | N/A | |
| LSP | N/A | |
| ISP | N/A | |
| DIP | VIOLATION | Context type is `typeof api` — derived from the concrete singleton, not an interface |

**Violations**

### DIP — Context type bound to the concrete `api` object shape
Symptom: `type APIServiceType = typeof api` makes the context type structurally identical to the concrete `api` singleton exported from `api.service.ts`. Any consumer of `useAPI()` now hard-depends on the concrete shape. Mocking or swapping the API implementation (e.g. for tests) requires the replacement to match the concrete object exactly — there is no interface contract.
Fix: Define an explicit `IAPIService` interface in a separate file (`src/renderer/src/services/IAPIService.ts`) that lists all method signatures. Change the context type to `IAPIService`. The concrete `api` object must satisfy this interface. Consumers type-check against the interface, not the implementation.
Effort: Low

---

## `src/main/services/whatsapp/IWAEventBus.ts`
Fan-in: 7 (imported by every WA event subscriber and emitter)

**Responsibilities**
1. Defines `AsyncHandler<T>` utility type
2. Defines `WAEventBusFactory` type alias
3. Defines `IWAEventBus` interface with `on`, `off`, `emit`, `removeAllListeners`

**SOLID Evaluation**
| Principle | Result | Notes |
|---|---|---|
| SRP | PASS | Single contract for the event bus abstraction |
| OCP | N/A | |
| LSP | N/A | |
| ISP | PASS | 4 methods; all consumers use most of them |
| DIP | PASS | Pure interface — no concrete imports |

> **No violations.** Clean, minimal event bus interface.

**Effort: N/A**

---

## `src/main/services/chats/IChatRepository.ts`
Fan-in: 8 (imported by ChatService, ChatListEnricher, SearchService, IPC handlers)

**Responsibilities**
1. Defines `ChatUpsertData` and `ChatWithCommunity` local data shapes
2. Defines `IChatReadRepository` (8 read methods)
3. Defines `IChatWriteRepository` (5 write methods)
4. Defines composite `IChatRepository`

**SOLID Evaluation**
| Principle | Result | Notes |
|---|---|---|
| SRP | PASS | Single concern: chat persistence contract |
| OCP | N/A | |
| LSP | N/A | |
| ISP | PASS | Read/write already segregated; consumers can depend on `IChatReadRepository` alone |
| DIP | N/A | |

> **No violations.** Read/write segregation is already applied correctly.

**Effort: N/A**

---

## `src/main/services/messages/IMessageQueryRepository.ts`
Fan-in: 9 (imported by MessageService, SearchService, EmbeddingService, ChatListEnricher, ServiceContainer)

**Responsibilities**
1. Defines existence-check operations (`findExistingIds`)
2. Defines single-message read operations (`findMessageById`, `findMessageWithSender`, `findMessageTypeAndContent`)
3. Defines batch/list read operations (`findMessagesByIds`, `findMessagesByChat`, `findChatMessagesWithSender`)
4. Defines ORM-style open queries (`findMessageIdsOnly(where: any)`, `findMessagesWithChatAndSender(where: any, take?)`) — leaking Prisma's where-clause shape into the interface
5. Defines cross-entity join queries (`findMessagesByIdsWithChatAndSender`, `findLastMessage`)
6. Defines embedding-specific query (`findMessagesWithTextContent`)

**SOLID Evaluation**
| Principle | Result | Notes |
|---|---|---|
| SRP | PASS | All methods are reads — single concern at the coarse level |
| OCP | N/A | |
| LSP | N/A | |
| ISP | VIOLATION | 11 methods; EmbeddingService uses 1, SearchService uses 2, MessageService uses 5–6 — consumers depend on methods they never call |
| DIP | VIOLATION | `findMessageIdsOnly(where: any)` and `findMessagesWithChatAndSender(where: any)` expose raw ORM where-clause shapes, leaking Prisma implementation detail into the interface |

**Violations**

### ISP — Fat query interface with 11 methods across unrelated consumer profiles
Symptom: `EmbeddingService` depends on `IMessageQueryRepository` but only calls `findMessagesWithTextContent`. `SearchService` calls `findMessagesWithChatAndSender` and `findMessagesByIdsWithChatAndSender`. `ChatListEnricher` calls `findLastMessage`. Each consumer is forced to type-check against all 11 methods.
Fix: Segregate into focused sub-interfaces: `IMessageExistenceRepository` (`findExistingIds`), `IMessageReadRepository` (single/batch lookups), `IMessageSearchRepository` (cross-entity joins for search), `IMessageIndexRepository` (`findMessagesWithTextContent` for embedding). Compose these as needed in `ServiceContainer`.
Effort: Medium

### DIP — Open `where: any` parameters leak ORM abstraction into the interface contract
Symptom: `findMessageIdsOnly(where: any)` and `findMessagesWithChatAndSender(where: any, take?: number)` accept raw Prisma where-clause objects. Callers must construct Prisma-shaped objects to use this interface — violating DIP by making high-level callers depend on the ORM query shape. `findLastMessage` and `findMessagesByIdsWithChatAndSender` both return `any`, losing the type-safety the interface is meant to provide.
Fix: Replace open `where: any` parameters with explicit, typed filter structs (e.g. `MessageFilter { chatJid?: string; fromDate?: bigint; toDate?: bigint }`). Replace `any` return types with concrete return shapes defined in `domain/types.ts`. This keeps ORM details inside the repository implementation only.
Effort: Medium

---

## `src/main/services/messages/formatters/MessageFormatter.ts`
Fan-in: 10 (imported by all concrete formatter implementations and the formatter registry)

**Responsibilities**
1. Defines `MessageFormattingContext` union type (the formatting target context)
2. Defines `FormatterMessageInput` (input shape for formatting)
3. Defines `IFormattedMessageContent` (parsed content shape with per-type fields)
4. Defines `MessageFormatter` strategy interface (`supports`, `format`)

**SOLID Evaluation**
| Principle | Result | Notes |
|---|---|---|
| SRP | PASS | Single concern: formatter strategy contract and its input/output types |
| OCP | PASS | New message types are handled by adding new formatter classes, not editing this file |
| LSP | N/A | |
| ISP | PASS | 2-method strategy interface; all consumers use both |
| DIP | PASS | Pure type definitions and interface — no concrete imports |

> **No violations.** Clean strategy pattern definition.

**Effort: N/A**

---

## Summary (Files 1–10)

| # | File | Violations | Effort |
|---|---|---|---|
| 1 | `services/whatsapp/types.ts` | None | N/A |
| 2 | `renderer/src/types.ts` | SRP, ISP | Low |
| 3 | `main/utils.ts` | None | N/A |
| 4 | `contacts/IContactService.ts` | SRP | Low |
| 5 | `domain/types.ts` | None | N/A |
| 6 | `context/APIContext.tsx` | DIP | Low |
| 7 | `whatsapp/IWAEventBus.ts` | None | N/A |
| 8 | `chats/IChatRepository.ts` | None | N/A |
| 9 | `messages/IMessageQueryRepository.ts` | ISP, DIP | Medium |
| 10 | `messages/formatters/MessageFormatter.ts` | None | N/A |

---

## `src/main/services/contacts/IIdentityRepository.ts`
Fan-in: 11 (imported by ContactService, IdentityReconciliationService, SearchService, MessageIdentityResolver)

**Responsibilities**
1. Defines local input types: `IdentityCreateInput`, `IdentityUpdateInput`, `IdentityWithAliases`, `ReferenceCounts`
2. Defines `IIdentityQueryRepository` (5 read methods)
3. Defines `IIdentityWriteRepository` (3 write methods)
4. Defines composite `IIdentityRepository`

**SOLID Evaluation**
| Principle | Result | Notes |
|---|---|---|
| SRP | PASS | Single concern: identity persistence contract |
| OCP | N/A | |
| LSP | N/A | |
| ISP | PASS | Read/write already segregated |
| DIP | N/A | |

> **No violations.** Read/write segregation already applied.

**Effort: N/A**

---

## `src/main/ipc/types.ts`
Fan-in: 12 (imported by IPC handlers, ChatService, MessageService, renderer-facing surfaces)

**Responsibilities**
1. Defines `EnrichedMessage` — IPC-boundary message shape for the renderer
2. Defines `ChatListItem` — IPC-boundary chat list shape for the renderer
3. Defines `EnrichedReaction` — IPC-boundary reaction shape

**SOLID Evaluation**
| Principle | Result | Notes |
|---|---|---|
| SRP | PASS | Single concern: IPC boundary data contracts |
| OCP | N/A | |
| LSP | N/A | |
| ISP | PASS | Types are small and cohesive |
| DIP | N/A | |

> **No violations.** Clean IPC boundary type file.

**Effort: N/A**

---

## `src/main/services/contacts/IAliasRepository.ts`
Fan-in: 13 (imported by ContactService, LidPnLinker, ContactNameResolver)

**Responsibilities**
1. Defines local types: `IdentityAliasWithIdentity`, `IdentityAliasMinimal`
2. Defines `IAliasQueryRepository` (5 read methods)
3. Defines `IAliasWriteRepository` (1 write method)
4. Defines composite `IAliasRepository`

**SOLID Evaluation**
| Principle | Result | Notes |
|---|---|---|
| SRP | PASS | Single concern: alias persistence contract |
| OCP | N/A | |
| LSP | N/A | |
| ISP | PASS | Read/write segregated; write side is a single method |
| DIP | N/A | |

> **No violations.** Clean, minimal interface with correct segregation.

**Effort: N/A**

---

## `src/main/services/messages/IMessageRepository.ts`
Fan-in: 14 (imported by MessageService, MessageActionService, MediaService, ServiceContainer)

**Responsibilities**
1. Re-exports `MessageUpsertData` from `domain/types`
2. Defines `IMessageWriteRepository` — 9 write methods
3. Defines composite `IMessageRepository`

**SOLID Evaluation**
| Principle | Result | Notes |
|---|---|---|
| SRP | PASS | Single concern: message write persistence |
| OCP | N/A | |
| LSP | N/A | |
| ISP | VIOLATION | Two methods mix write and read: `updateAndFetchMessageWithSender` and `updateContentAndFetchWithSender` return hydrated read projections from a write interface |
| DIP | N/A | |

**Violations**

### ISP — Write interface contains read-returning compound operations
Symptom: `updateAndFetchMessageWithSender(id, textContent, content): Promise<DBMessageWithSender | null>` and `updateContentAndFetchWithSender(id, content): Promise<DBMessageWithSender | null>` both mutate state AND return a joined read projection. They belong in `IMessageWriteRepository` by naming convention but semantically require the sender join from the read side. Consumers that only need pure writes depend on these read-returning methods.
Fix: Move the "update and fetch" compound methods to a dedicated `IMessageMutationReadRepository` sub-interface (or inline them in `IMessageQueryRepository` as post-write read operations). `IMessageWriteRepository` should contain only fire-and-forget mutations that return `void` or the updated entity alone — not joined projections.
Effort: Low

---

## `src/main/services/messages/IReactionRepository.ts`
Fan-in: 15 (imported by MessageService, MessageActionService, ChatListEnricher, ServiceContainer)

**Responsibilities**
1. Defines local types: `ReactionSyncData`, `LastReactionInfo`
2. Defines `IReactionQueryRepository` (2 read methods)
3. Defines `IReactionWriteRepository` (3 write/sync methods)
4. Defines composite `IReactionRepository`

**SOLID Evaluation**
| Principle | Result | Notes |
|---|---|---|
| SRP | PASS | Single concern: reaction persistence contract |
| OCP | N/A | |
| LSP | N/A | |
| ISP | PASS | Read/write segregated; both sides are small and focused |
| DIP | N/A | |

> **No violations.** Clean, well-segregated reaction repository interface.

**Effort: N/A**

---

## `src/main/services/search/EmbeddingService.ts`
Fan-in: 16 (imported by SearchService, WACatchUpManager, IPC handlers, ServiceContainer)

**Responsibilities**
1. **Defines `IEmbeddingService` interface** — co-located with the concrete class in the same file
2. Manages embedding model state (`modelName`, `isPaused`, `activeJobs`)
3. Tracks and notifies consumers about active-job state changes (`onActiveStateChange`)
4. Coordinates single-message embedding via an internal queue (`indexQueue`, `processQueue`)
5. Coordinates bulk embedding across all messages (`indexAll`)
6. Syncs vector data from persistent store to the SQLite virtual FTS table (`syncVectors`)

**SOLID Evaluation**
| Principle | Result | Notes |
|---|---|---|
| SRP | VIOLATION | Class manages queue/model state AND vector table sync — two distinct operations |
| OCP | N/A | |
| LSP | N/A | |
| ISP | PASS | Interface is focused and all methods are used |
| DIP | VIOLATION | `IEmbeddingService` is defined in the same file as `EmbeddingService`; importing the interface forces a transitive import of the concrete class |

**Violations**

### SRP — Vector sync concern mixed into embedding service
Symptom: `syncVectors()` reads all stored vectors, checks their dimensionality, deletes stale entries, and re-inserts them into a virtual FTS table. This is a database maintenance/repair operation — it has nothing to do with coordinating embedding generation. If the vector table schema changes (e.g. dimension threshold changes from 768), `EmbeddingService` must be edited. That is a separate reason to change from the embedding generation logic.
Fix: Extract `syncVectors` (and the dimension-mismatch logic) into a `VectorSyncService` that takes `IMessageVectorRepository` as its only dependency. `EmbeddingService` should not know about vector table maintenance.
Effort: Low

### DIP — Interface co-located with its concrete implementation
Symptom: `IEmbeddingService` is exported from `EmbeddingService.ts`. Every file that needs only the interface (`import { IEmbeddingService } from './EmbeddingService'`) also transitively loads the concrete class, the queue logic, and all its imports. This is the same pattern the rest of the codebase avoids (all other services have separate `IFooService.ts` files).
Fix: Move `IEmbeddingService` to `src/main/services/search/IEmbeddingService.ts`. Update all imports. `EmbeddingService.ts` then imports from `IEmbeddingService.ts`, consistent with the rest of the codebase.
Effort: Low

---

## `src/main/services/ai/AIToolService.ts`
Fan-in: 17 (imported by AI tool registration code and IPC handlers)

**Responsibilities**
1. Implements `ToolRegistry` class — registers, retrieves, and lists AI tools
2. **Exports `toolRegistry` — a concrete singleton instantiated at module load time**

**SOLID Evaluation**
| Principle | Result | Notes |
|---|---|---|
| SRP | PASS | The class itself has one concern: tool registration and lookup |
| OCP | PASS | New tools are registered externally; this file is not edited |
| LSP | N/A | |
| ISP | PASS | `IToolRegistry` interface is small and fully used |
| DIP | VIOLATION | `export const toolRegistry = new ToolRegistry(new SystemPromptBuilder())` — global singleton bypasses DI container; `SystemPromptBuilder` is instantiated with `new` directly |

**Violations**

### DIP — Global singleton bypasses DI container and uses direct instantiation
Symptom: `export const toolRegistry = new ToolRegistry(new SystemPromptBuilder())` at the module level creates a global shared instance that is imported directly by consumers (`import { toolRegistry } from './AIToolService'`). This violates DIP in two ways: (1) `ToolRegistry` constructs its own `SystemPromptBuilder` dependency instead of receiving it injected; (2) consumers import the concrete singleton rather than depending on `IToolRegistry`. Neither `ToolRegistry` nor `toolRegistry` appear in `ServiceContainer`.
Fix: Remove the `export const toolRegistry` line. Add `ToolRegistry` to `ServiceContainer` — instantiate it there with `new ToolRegistry(new SystemPromptBuilder())` and expose it as `toolRegistry: IToolRegistry`. Consumers receive it via DI. The `IToolRegistry.ts` import already exists and is correctly shaped.
Effort: Low

---

## `src/main/services/chats/types.ts`
Fan-in: 18 (imported by chat sync handlers and group hydration service)

**Responsibilities**
1. Defines `BaileysGroupMetadata` — raw Baileys group payload shape used during sync

**SOLID Evaluation**
| Principle | Result | Notes |
|---|---|---|
| SRP | PASS | Single type definition for a single external payload shape |
| OCP | N/A | |
| LSP | N/A | |
| ISP | PASS | Single interface |
| DIP | N/A | |

> **No violations.** Minimal, focused type file.

**Effort: N/A**

---

## `src/main/services/whatsapp/WAEventTypes.ts`
Fan-in: 19 (imported by IWAEventBus, WAEventBus, all subscribers, WAEventWiringService)

**Responsibilities**
1. Barrel re-exports all domain event types from six sub-modules (`messageEvents`, `chatEvents`, `contactEvents`, `groupEvents`, `syncEvents`, `miscEvents`)
2. Imports and assembles `WAEventMap` — the master type-safe event-name-to-payload registry

**SOLID Evaluation**
| Principle | Result | Notes |
|---|---|---|
| SRP | PASS | Both responsibilities are tightly coupled: the map cannot exist without the event types |
| OCP | PASS | Adding a new event means adding a new sub-module and extending `WAEventMap` — existing entries are untouched |
| LSP | N/A | |
| ISP | PASS | Subscribers import individual event types from the sub-modules; `WAEventMap` is used only by the bus |
| DIP | N/A | |

> **No violations.** Well-structured event registry; OCP is actively respected via the sub-module pattern.

**Effort: N/A**

---

## `src/main/services/ai/IAIKeyService.ts`
Fan-in: 20 (imported by AIKeyService, AIService, ServiceContainer, IPC handlers)

**Responsibilities**
1. Defines `ProviderKeys` type alias
2. Defines `IAIKeyService` interface (3 methods: `getKeys`, `getKey`, `saveKey`)

**SOLID Evaluation**
| Principle | Result | Notes |
|---|---|---|
| SRP | PASS | Single concern: AI provider key management contract |
| OCP | N/A | |
| LSP | N/A | |
| ISP | PASS | 3 methods, all used by consumers |
| DIP | N/A | |

> **No violations.** Clean, minimal service interface.

**Effort: N/A**

---

## Running Summary (Files 1–20)

| # | File | Violations | Effort |
|---|---|---|---|
| 1 | `services/whatsapp/types.ts` | None | N/A |
| 2 | `renderer/src/types.ts` | SRP, ISP | Low |
| 3 | `main/utils.ts` | None | N/A |
| 4 | `contacts/IContactService.ts` | SRP | Low |
| 5 | `domain/types.ts` | None | N/A |
| 6 | `context/APIContext.tsx` | DIP | Low |
| 7 | `whatsapp/IWAEventBus.ts` | None | N/A |
| 8 | `chats/IChatRepository.ts` | None | N/A |
| 9 | `messages/IMessageQueryRepository.ts` | ISP, DIP | Medium |
| 10 | `messages/formatters/MessageFormatter.ts` | None | N/A |
| 11 | `contacts/IIdentityRepository.ts` | None | N/A |
| 12 | `ipc/types.ts` | None | N/A |
| 13 | `contacts/IAliasRepository.ts` | None | N/A |
| 14 | `messages/IMessageRepository.ts` | ISP | Low |
| 15 | `messages/IReactionRepository.ts` | None | N/A |
| 16 | `search/EmbeddingService.ts` | SRP, DIP | Low |
| 17 | `ai/AIToolService.ts` | DIP | Low |
| 18 | `chats/types.ts` | None | N/A |
| 19 | `whatsapp/WAEventTypes.ts` | None | N/A |
| 20 | `ai/IAIKeyService.ts` | None | N/A |

**Cumulative violations (files 1–20): 8**
- SRP: 3 (`renderer/types.ts`, `IContactService.ts`, `EmbeddingService.ts`)
- ISP: 3 (`renderer/types.ts`, `IMessageQueryRepository.ts`, `IMessageRepository.ts`)
- DIP: 4 (`APIContext.tsx`, `IMessageQueryRepository.ts`, `EmbeddingService.ts`, `AIToolService.ts`)

---

## `src/main/services/chats/IChatService.ts`
Fan-in: 21 (imported by ChatService, IPC handlers, GroupHydrationService, WAEventWiringService)

**Responsibilities**
1. Defines `IChatQueryService` — `getChatList`, `isChatMuted`
2. Defines `IChatMutationService` — `upsertChat`, `markRead`, `incrementUnread`, `updateTimestamp`
3. Defines `IGroupParticipantResolver` — `getGroupParticipants`
4. Defines composite `IChatService`

**SOLID Evaluation**
| Principle | Result | Notes |
|---|---|---|
| SRP | PASS | Sub-interfaces correctly separate query, mutation, and group resolver concerns |
| OCP | N/A | |
| LSP | N/A | |
| ISP | PASS | Sub-interfaces already segregated; composite is fine |
| DIP | VIOLATION | Interface imports `WASocket` from Baileys transport layer and `ChatListItem` from `ipc/types` — leaking two infrastructure layers into the service contract |

**Violations**

### DIP — Service interface depends on transport-layer and IPC-boundary types
Symptom: `getChatList()` returns `ChatListItem[]` — a type defined in `src/main/ipc/types.ts`, which is the IPC wire format for the renderer. A service interface should return a domain type; the IPC handler is responsible for converting it. Additionally, `getGroupParticipants(jid, sock: WASocket | null)` accepts `WASocket` — a Baileys library type — directly in the service contract. Any consumer of `IGroupParticipantResolver` now depends on the Baileys library at the type level, even if it never calls this method.
Fix: Replace `ChatListItem` with a domain-level `ChatListEntry` type defined in `domain/types.ts` (or `services/chats/chatDomainTypes.ts`). The IPC handler layer converts the result to `ChatListItem` before sending to the renderer. Replace `WASocket | null` with a narrow `ISocketAccessor` abstraction (a function type `() => WASocket | null` already exists as `SocketAccessor` in `whatsapp/types.ts` — use that or extract a minimal interface). The goal: `IChatService` imports nothing from Baileys or `ipc/types`.
Effort: Medium

---

## `src/main/services/ai/providers/Provider.ts`
Fan-in: 22 (imported by AIService, all concrete provider implementations, ServiceContainer)

**Responsibilities**
1. Defines `ModelInfo` — shared AI model descriptor type
2. Defines `AIProvider` — the strategy interface all AI providers must implement (6 required methods + 1 optional)

**SOLID Evaluation**
| Principle | Result | Notes |
|---|---|---|
| SRP | PASS | Both types are cohesive: `ModelInfo` is the return type of `getAvailableModels` |
| OCP | PASS | New providers are added as new classes; this file is never edited |
| LSP | N/A | |
| ISP | VIOLATION | `generateResponseStream` and `generateResponse` are both required — providers that support only one mode must stub the other |
| DIP | N/A | Pure interface definitions |

**Violations**

### ISP — Both streaming and non-streaming generation required on all providers
Symptom: `AIProvider` requires implementors to provide both `generateResponseStream(...)` and `generateResponse(...)`. If a provider only supports streaming (e.g., a local LM Studio model), it must provide a `generateResponse` implementation anyway, likely by buffering the stream — which is an adaptor concern, not a provider concern. Similarly a non-streaming-only provider must stub `generateResponseStream`. This forces all providers to implement a superset of what they natively support.
Fix: Split into `IStreamingProvider` (with `generateResponseStream`) and `IFullResponseProvider` (with `generateResponse`). Define a composed `IFullAIProvider` that extends both, for providers that genuinely support both. `AIService` depends on the narrowest interface it actually needs per call-site.
Effort: Medium

---

## `src/main/services/ai/SystemPromptBuilder.ts`
Fan-in: 23 (imported by AIToolService, all AI providers that call `getSystemInstructions`)

**Responsibilities**
1. Formats tool definitions into markdown strings
2. Embeds hardcoded magic-string fallback values for user identity fields (`'919931386969'`, `'187273727488097'`)
3. Defines and inlines the full REACT protocol prompt text
4. Defines and inlines the full STANDARD protocol prompt text
5. Assembles the final system prompt by stitching static sections (ROLE, WHAT WHATSAPP IS, YOUR DISPOSITION, MESSAGE ROLES, USER IDENTITY, TOOLS, PROTOCOL)

**SOLID Evaluation**
| Principle | Result | Notes |
|---|---|---|
| SRP | VIOLATION | The class mixes tool-list formatting, static domain-knowledge copy, user-identity injection, and protocol selection — four distinct reasons to change |
| OCP | VIOLATION | Adding a third response mode requires editing the `useThinkMode ? reactProtocol : standardProtocol` ternary inside `build()` |
| LSP | N/A | |
| ISP | PASS | `ISystemPromptBuilder.build()` is a single-method interface |
| DIP | N/A | No concrete imports |

**Violations**

### SRP — Single `build()` method bundles four unrelated concerns
Symptom: The `build()` method (163 lines) contains: (1) tool-list markdown formatter, (2) magic-string identity fallbacks for `phoneNum`/`lid`/`phoneJid`/`linkedJid`, (3) the full inline `reactProtocol` string (~25 lines of prompt text), (4) the full inline `standardProtocol` string (~25 lines of prompt text), (5) the multi-section static "What WhatsApp is / Your Disposition / Message Roles" copy that never changes. Each of these has a different reason to change — the tool formatter changes when tool schema format changes; the static copy changes when product copy changes; the identity block changes when the identity model changes; the protocol block changes when the AI interaction model changes.
Fix: Extract static prompt sections into a `SystemPromptContent` constant file (or a `PromptSections` namespace). Extract tool formatting into a `ToolDefinitionFormatter` helper. The `SystemPromptBuilder.build()` becomes an assembly method that calls these helpers, remaining under ~20 lines.
Effort: Medium

### OCP — Protocol selection via boolean ternary requires editing `build()` for new modes
Symptom: `${useThinkMode ? reactProtocol : standardProtocol}` is a closed binary switch. Adding a third protocol mode (e.g. `'structured'`) requires modifying `build()` directly — violating OCP. The `ISystemPromptBuilder.build(tools, useThinkMode, userDetails)` signature itself bakes in the boolean, forcing the same edit point at the interface level.
Fix: Replace the `useThinkMode: boolean` parameter with a `protocolMode: 'react' | 'standard'` string literal type (extensible without changing existing callers). Better: pass a `IProtocolStrategy` (an object with a `getProtocolBlock()` method) so new modes are added as new strategy objects, not edits to `build()`. The registry of available strategies lives in the composition root.
Effort: Medium

---

## `src/main/services/whatsapp/subscribers/IWAEventSubscriber.ts`
Fan-in: 24 (implemented by every WA event subscriber class)

**Responsibilities**
1. Defines `IWAEventSubscriber` — the lifecycle contract for event subscribers (`register`, `dispose`)

**SOLID Evaluation**
| Principle | Result | Notes |
|---|---|---|
| SRP | PASS | Single concern: subscriber lifecycle contract |
| OCP | N/A | |
| LSP | N/A | |
| ISP | PASS | 2-method interface; both methods are used by all implementors |
| DIP | PASS | Only imports `IWAEventBus` — the abstraction, not the concrete bus |

> **No violations.** Minimal, clean lifecycle interface. Correctly depends only on the bus abstraction.

**Effort: N/A**

---

## `src/renderer/src/utils/formatters.ts`
Fan-in: 25 (imported by chat list, message view, receipt view, and sender display components)

**Responsibilities**
1. Formats Unix timestamps into time strings (`formatTime`, `formatChatTime`, `formatReceiptTime`)
2. Formats Unix timestamps into date strings (`formatDate`, `formatReceiptDate`)
3. Evaluates mute state from an expiration timestamp (`isMuted`)
4. Formats sender display names (`formatSenderName`)

**SOLID Evaluation**
| Principle | Result | Notes |
|---|---|---|
| SRP | PASS | All functions are pure display-formatting utilities; one reason to change (display format requirements) |
| OCP | N/A | Pure functions |
| LSP | N/A | No inheritance |
| ISP | PASS | Consumers import specific functions via named imports |
| DIP | PASS | No dependencies; pure functions |

> **No violations.** Well-focused pure utility module.

**Effort: N/A**

---

## Final Summary — All 25 Files

| # | File | Violations | Effort |
|---|---|---|---|
| 1 | `services/whatsapp/types.ts` | None | N/A |
| 2 | `renderer/src/types.ts` | SRP, ISP | Low |
| 3 | `main/utils.ts` | None | N/A |
| 4 | `contacts/IContactService.ts` | SRP | Low |
| 5 | `domain/types.ts` | None | N/A |
| 6 | `context/APIContext.tsx` | DIP | Low |
| 7 | `whatsapp/IWAEventBus.ts` | None | N/A |
| 8 | `chats/IChatRepository.ts` | None | N/A |
| 9 | `messages/IMessageQueryRepository.ts` | ISP, DIP | Medium |
| 10 | `messages/formatters/MessageFormatter.ts` | None | N/A |
| 11 | `contacts/IIdentityRepository.ts` | None | N/A |
| 12 | `ipc/types.ts` | None | N/A |
| 13 | `contacts/IAliasRepository.ts` | None | N/A |
| 14 | `messages/IMessageRepository.ts` | ISP | Low |
| 15 | `messages/IReactionRepository.ts` | None | N/A |
| 16 | `search/EmbeddingService.ts` | SRP, DIP | Low |
| 17 | `ai/AIToolService.ts` | DIP | Low |
| 18 | `chats/types.ts` | None | N/A |
| 19 | `whatsapp/WAEventTypes.ts` | None | N/A |
| 20 | `ai/IAIKeyService.ts` | None | N/A |
| 21 | `chats/IChatService.ts` | DIP | Medium |
| 22 | `ai/providers/Provider.ts` | ISP | Medium |
| 23 | `ai/SystemPromptBuilder.ts` | SRP, OCP | Medium |
| 24 | `subscribers/IWAEventSubscriber.ts` | None | N/A |
| 25 | `renderer/src/utils/formatters.ts` | None | N/A |

**Total violations: 12**
| Principle | Count | Files |
|---|---|---|
| SRP | 4 | `renderer/types.ts`, `IContactService.ts`, `EmbeddingService.ts`, `SystemPromptBuilder.ts` |
| OCP | 1 | `SystemPromptBuilder.ts` |
| ISP | 4 | `renderer/types.ts`, `IMessageQueryRepository.ts`, `IMessageRepository.ts`, `providers/Provider.ts` |
| DIP | 5 | `APIContext.tsx`, `IMessageQueryRepository.ts`, `EmbeddingService.ts`, `AIToolService.ts`, `IChatService.ts` |

**Effort breakdown across violated files:**
- Low: 5 files (`renderer/types.ts`, `IContactService.ts`, `APIContext.tsx`, `IMessageRepository.ts`, `EmbeddingService.ts`, `AIToolService.ts`)
- Medium: 4 files (`IMessageQueryRepository.ts`, `IChatService.ts`, `providers/Provider.ts`, `SystemPromptBuilder.ts`)
- High: 0 files

---

## Phase-Wise Refactoring Plan

---

### Phase 1: Renderer Type Segregation
**Objective:** Break the 370-line `renderer/src/types.ts` monolith into focused type modules so that renderer components import only the types they need.

**Files in scope:**
- `src/renderer/src/types.ts` *(split — will be deleted after migration)*
- `src/renderer/src/types/chatTypes.ts` *(NEW)*
- `src/renderer/src/types/aiTypes.ts` *(NEW)*
- `src/renderer/src/types/mediaTypes.ts` *(NEW)*
- `src/renderer/src/types/componentProps.ts` *(NEW)*
- `src/renderer/src/services/api.service.ts` *(update imports)*
- All renderer components that import from `types.ts` *(update imports)*

**What changes:**
- Create `chatTypes.ts` containing: `ChatItem`, `ExtendedChatItem`, `SelectedContext`, `MessageItem`, `ReactionItem`, `MessageReceiptInfo`, `SearchResultItem`, `SearchMode`, `SearchFilters`, `SearchResults`, `PresenceEntry`, `PresenceMap`, `PresenceUpdate`, `GroupParticipant`, `NotificationPreferences`
- Create `aiTypes.ts` containing: `ModelInfo`, `AIChatOptions`, `AIChatSessionItem`, `AIContextItem`, `AIChatMessage`, `ToolDefinition`
- Create `mediaTypes.ts` containing: all raw protocol/content shapes (`RawMessageContent`, `ContextInfo`, `ImageMessageContent`, `VideoMessageContent`, `AudioMessageContent`, `DocumentMessageContent`, `StickerMessageContent`, `HydratedButton`, `HydratedTemplate`, `InteractiveButton`, `InteractiveMessageTemplate`, `TemplateMessageContent`, `JPEGThumbnail`, `JPEGThumbnailBuffer`) and the `isJPEGThumbnailBuffer` type guard
- Create `componentProps.ts` containing: `BaseMediaMessageProps`, `ImageMessageProps`, `VideoMessageProps`, `DocumentMessageProps`, `AudioMessageProps`, `StickerMessageProps`, `TemplateMessageProps`, `TextMessageProps`
- Add `MessageType` union to `chatTypes.ts` (used by message rendering)
- Delete the original `types.ts` (or keep as a re-export barrel if the migration is phased)
- Update `api.service.ts` imports and all component imports to use the new split files

**Verification:** `npm run typecheck` returns zero errors

**Status:** [x] COMPLETED

---

### Phase 2: Utility Extraction from Interface Files
**Objective:** Remove the concrete `getDisplayName` runtime function from `IContactService.ts` so the interface file contains only type contracts.

**Files in scope:**
- `src/main/services/contacts/IContactService.ts` *(remove `getDisplayName`)*
- `src/main/utils/contactUtils.ts` *(NEW — receives `getDisplayName`)*
- All files that currently import `getDisplayName` from `IContactService.ts` *(update import path)*

**What changes:**
- Move `getDisplayName(identity, fallback)` verbatim into `src/main/utils/contactUtils.ts`
- Export it from there
- Update every import site (`import { getDisplayName } from '../contacts/IContactService'`) to point to the new path
- `IContactService.ts` is left containing only the four sub-interfaces and the composite `IContactService`

**Verification:** `npm run typecheck` returns zero errors

**Status:** [x] COMPLETED

**Completed:** 2026-06-21 — Files changed: 3. Files created: 1 (contactUtils.ts). Blockers: none

---

### Phase 3: Renderer API Abstraction
**Objective:** Define an explicit `IAPIService` interface for the renderer API so that `APIContext` and all consumers depend on an abstraction, not the concrete `api` object shape.

**Files in scope:**
- `src/renderer/src/services/IAPIService.ts` *(NEW)*
- `src/renderer/src/context/APIContext.tsx` *(update context type)*
- `src/renderer/src/services/api.service.ts` *(must satisfy `IAPIService`)*

**What changes:**
- Create `IAPIService.ts` listing every method signature currently on the `api` object (all ~50 methods). Types for parameters and return values are imported from the split type files produced in Phase 1
- Change `APIContext.tsx`: replace `type APIServiceType = typeof api` with `import { IAPIService } from '../services/IAPIService'`; type the context as `IAPIService | undefined`
- The concrete `api` object implicitly satisfies `IAPIService` — no structural changes to `api.service.ts`, only a type assertion or explicit `satisfies IAPIService` annotation to enforce the contract at compile time

**Verification:** `npm run typecheck` returns zero errors
 
**Status:** [x] COMPLETED

**Completed:** 2026-06-21 — Files changed: 2. Files created: 1 (IAPIService.ts). Blockers: none

---

### Phase 4: Message Repository Interface Cleanup
**Objective:** Fix the ISP and DIP violations in `IMessageQueryRepository` (fat interface with `any` leakage) and the ISP violation in `IMessageRepository` (compound read-write methods in a write interface).

**Files in scope:**
- `src/main/services/messages/IMessageQueryRepository.ts` *(split + replace `any`)*
- `src/main/services/messages/IMessageExistenceRepository.ts` *(NEW)*
- `src/main/services/messages/IMessageSearchRepository.ts` *(NEW)*
- `src/main/services/messages/IMessageIndexRepository.ts` *(NEW)*
- `src/main/services/messages/IMessageRepository.ts` *(move compound methods)*
- `src/main/services/messages/IMessageCompoundRepository.ts` *(NEW — compound update+fetch methods)*
- `src/main/services/messages/MessageQueryRepository.ts` *(implement all new sub-interfaces)*
- `src/main/services/messages/MessageRepository.ts` *(implement `IMessageCompoundRepository`)*
- `src/main/domain/types.ts` *(add typed filter structs if needed)*
- `src/main/ServiceContainer.ts` *(update types to composed narrower interfaces)*
- All consumers of `IMessageQueryRepository` *(update to narrower interface dependency)*

**What changes:**
- Define `MessageQueryFilter { chatJid?: string; fromDate?: bigint; toDate?: bigint; fromMe?: boolean }` in `domain/types.ts` to replace `where: any`
- Split `IMessageQueryRepository` into: `IMessageExistenceRepository` (`findExistingIds`), `IMessageReadRepository` (single/batch/paginated lookups — keep in main file), `IMessageSearchRepository` (cross-entity joins: `findMessagesByIdsWithChatAndSender`, `findMessagesWithChatAndSender`, `findLastMessage`), `IMessageIndexRepository` (`findMessagesWithTextContent`)
- Replace `findLastMessage(): Promise<any>` and `findMessagesByIdsWithChatAndSender(): Promise<any[]>` with typed return shapes defined in `domain/types.ts`
- Replace `findMessageIdsOnly(where: any)` and `findMessagesWithChatAndSender(where: any)` with the new `MessageQueryFilter` parameter
- Move `updateAndFetchMessageWithSender` and `updateContentAndFetchWithSender` from `IMessageWriteRepository` into a new `IMessageCompoundRepository` interface
- Update `ServiceContainer` to expose the composed types: `messageQueryRepository: IMessageReadRepository & IMessageExistenceRepository & IMessageSearchRepository & IMessageIndexRepository`; `messageRepository: IMessageWriteRepository & IMessageCompoundRepository`
- Each service takes only the narrowest sub-interface it needs (e.g. `EmbeddingService` takes `IMessageIndexRepository`, `SearchService` takes `IMessageSearchRepository`)

**Verification:** `npm run typecheck` returns zero errors

**Status:** [x] COMPLETED

**Completed:** 2026-06-21 — Files changed: 12. Files created: 4. Blockers: none

---

### Phase 5: Embedding Service Decoupling
**Objective:** Extract `IEmbeddingService` into its own file (consistent with codebase pattern) and move the `syncVectors` maintenance operation out of `EmbeddingService` into a dedicated `VectorSyncService`.

**Files in scope:**
- `src/main/services/search/IEmbeddingService.ts` *(NEW — receives `IEmbeddingService`)*
- `src/main/services/search/EmbeddingService.ts` *(remove interface export; remove `syncVectors`)*
- `src/main/services/search/IVectorSyncService.ts` *(NEW)*
- `src/main/services/search/VectorSyncService.ts` *(NEW — receives `syncVectors` logic)*
- `src/main/ServiceContainer.ts` *(update import; add `vectorSyncService`)*
- All files importing `IEmbeddingService` from `EmbeddingService.ts` *(update to `IEmbeddingService.ts`)*

**What changes:**
- Create `IEmbeddingService.ts` with the `IEmbeddingService` interface exactly as it currently exists in `EmbeddingService.ts`
- Remove the `IEmbeddingService` export from `EmbeddingService.ts`; import it instead from the new file
- Create `VectorSyncService` (implements `IVectorSyncService`) with a single `sync(): Promise<void>` method containing the current `syncVectors` body. It takes `IMessageVectorRepository` as its only constructor dependency
- Remove `syncVectors()` from `EmbeddingService` and from `IEmbeddingService`
- Add `vectorSyncService: IVectorSyncService` to `ServiceContainer`; wire up call-sites that currently call `embeddingService.syncVectors()` to call `vectorSyncService.sync()` instead

**Verification:** `npm run typecheck` returns zero errors

**Status:** [x] Done

---

### Phase 6: DI Container — Wire AIToolService Singleton
**Objective:** Remove the `export const toolRegistry` global singleton from `AIToolService.ts` and route it through the DI container.

**Files in scope:**
- `src/main/services/ai/AIToolService.ts` *(remove singleton export)*
- `src/main/ServiceContainer.ts` *(add `toolRegistry: IToolRegistry`)*
- All files importing `toolRegistry` directly *(update to receive it via DI)*

**What changes:**
- Delete `export const toolRegistry = new ToolRegistry(new SystemPromptBuilder())` from `AIToolService.ts`
- In `ServiceContainer.createServices()`, add: `const toolRegistry = new ToolRegistry(new SystemPromptBuilder())`
- Add `toolRegistry: IToolRegistry` to the `ServiceContainer` type and to the `Object.assign(services, {...})` block
- Every current consumer of `import { toolRegistry } from './AIToolService'` receives it via the service container instead (typically via the IPC handler wiring or via constructor injection)
- `AIToolService.ts` now exports only `ToolRegistry` (the class) — no singleton

**Verification:** `npm run typecheck` returns zero errors

**Status:** [x] Done

---

### Phase 7: IChatService Transport Decoupling
**Objective:** Remove `ChatListItem` (IPC boundary type) and `WASocket` (Baileys transport type) from `IChatService.ts` so the service contract depends only on domain types.

**Files in scope:**
- `src/main/services/chats/IChatService.ts` *(replace imported types)*
- `src/main/domain/types.ts` *(add `ChatListEntry` domain type)*
- `src/main/services/chats/ChatService.ts` *(update `getChatList` return type and `getGroupParticipants` signature)*
- `src/main/ipc/types.ts` *(IPC handler must now convert `ChatListEntry[]` → `ChatListItem[]`)*
- Relevant IPC handler(s) that call `chatService.getChatList()` *(add conversion step)*

**What changes:**
- Add `ChatListEntry` to `domain/types.ts` — a domain-level chat list shape that mirrors the current `ChatListItem` fields but lives in the domain layer (not the IPC layer)
- In `IChatQueryService`, change `getChatList(page?, pageSize?): Promise<ChatListItem[]>` to `getChatList(page?, pageSize?): Promise<ChatListEntry[]>`
- In `IGroupParticipantResolver`, the `sock` parameter type `WASocket | null` is replaced with `SocketAccessor` (the `() => WASocket | null` type already defined in `whatsapp/types.ts`), or the socket is removed from the interface entirely and resolved internally by the implementation
- Update `ChatService.getChatList()` implementation to return `ChatListEntry[]`
- IPC handler converts `ChatListEntry[]` to `ChatListItem[]` before sending to renderer (a simple identity-like mapping since the shapes are identical — this keeps the IPC boundary clean)
- Remove `import { ChatListItem } from '../../ipc/types'` and `import { WASocket } from '../whatsapp/types'` from `IChatService.ts`

**Verification:** `npm run typecheck` returns zero errors

**Status:** [x] COMPLETED
**Completed:** 2026-06-21 — Files changed: 4. Interfaces created: ChatListEntry. Blockers: none

---

### Phase 8: AI Provider Interface Segregation
**Objective:** Split the monolithic `AIProvider` interface so that providers implement only the generation modes they natively support.

**Files in scope:**
- `src/main/services/ai/providers/Provider.ts` *(split `AIProvider`)*
- `src/main/services/ai/providers/IStreamingProvider.ts` *(NEW)*
- `src/main/services/ai/providers/IFullResponseProvider.ts` *(NEW)*
- `src/main/services/ai/AIService.ts` *(use narrower interfaces per call-site)*
- All concrete provider implementations *(implement only the interfaces they support)*

**What changes:**
- Extract `generateResponseStream(...)` into `IStreamingProvider`
- Extract `generateResponse(...)` into `IFullResponseProvider`
- Keep `AIProvider` as a composed `IStreamingProvider & IFullResponseProvider` for providers that support both (most will)
- `AIService` uses `IStreamingProvider` for stream call-sites and `IFullResponseProvider` for non-stream call-sites. A provider that only supports one mode satisfies the narrower interface; `AIService` checks capability via `canHandleModel` before choosing the call path
- Providers that were previously forced to stub one method no longer need to — they simply implement the interface(s) that match their capabilities
- `ModelInfo` stays in `Provider.ts` as it is a shared type used by all provider interfaces

**Verification:** `npm run typecheck` returns zero errors

**Status:** [x] COMPLETED
**Completed:** 2026-06-21 — Files changed: 8. Interfaces created: IStreamingProvider, IFullResponseProvider. Blockers: none

---

### Phase 9: SystemPromptBuilder Restructuring
**Objective:** Break `SystemPromptBuilder.ts` into focused units — static content, tool formatter, and protocol strategy — eliminating the SRP and OCP violations.

**Files in scope:**
- `src/main/services/ai/SystemPromptBuilder.ts` *(reduce to assembly-only)*
- `src/main/services/ai/prompts/SystemPromptContent.ts` *(NEW — static sections)*
- `src/main/services/ai/prompts/ToolDefinitionFormatter.ts` *(NEW — tool markdown formatter)*
- `src/main/services/ai/prompts/IProtocolStrategy.ts` *(NEW — protocol strategy interface)*
- `src/main/services/ai/prompts/ReactProtocolStrategy.ts` *(NEW)*
- `src/main/services/ai/prompts/StandardProtocolStrategy.ts` *(NEW)*
- `src/main/services/ai/ISystemPromptBuilder.ts` *(update `build` signature)*
- `src/main/services/ai/AIToolService.ts` / `src/main/ServiceContainer.ts` *(wire protocol strategies)*

**What changes:**
- Create `SystemPromptContent.ts` with exported string constants for the static sections: `ROLE_SECTION`, `WHATSAPP_CONTEXT_SECTION`, `DISPOSITION_SECTION`, `MESSAGE_ROLES_SECTION`. These never change at runtime
- Create `ToolDefinitionFormatter.ts` with a `formatTools(tools: any[]): string` pure function that converts the tool array into the markdown string currently inlined in `build()`
- Create `IProtocolStrategy` interface with a single method `getProtocolBlock(): string`
- Create `ReactProtocolStrategy` and `StandardProtocolStrategy` as two implementations of `IProtocolStrategy`, each containing the protocol text currently inlined as `reactProtocol` / `standardProtocol` local variables
- Update `ISystemPromptBuilder.build(tools, protocolMode: 'react' | 'standard', userDetails?)` — replacing the `useThinkMode: boolean` with `protocolMode` (a string literal union, extensible without editing `build()`). Alternatively, inject `IProtocolStrategy` directly into `SystemPromptBuilder` constructor and remove the mode parameter entirely
- `SystemPromptBuilder.build()` becomes a ~15-line assembly method: call formatter, read static sections, inject identity, call `protocolStrategy.getProtocolBlock()`, concatenate
- Remove the hardcoded magic-string fallbacks (`'919931386969'`, `'187273727488097'`) — these should be handled by the caller passing complete `UserDetails`; if identity is unavailable, the caller passes empty strings or a sentinel, not a hardcoded real number
- Wire the concrete strategy into `ToolRegistry` via `ServiceContainer` (or accept it as a constructor parameter)

**Verification:** `npm run typecheck` returns zero errors

**Status:** [x] COMPLETED
**Completed:** 2026-06-21 — Files changed: 4. Files created: SystemPromptContent.ts, ToolDefinitionFormatter.ts, IProtocolStrategy.ts, ReactProtocolStrategy.ts, StandardProtocolStrategy.ts. Interfaces created: IProtocolStrategy. Blockers: none
