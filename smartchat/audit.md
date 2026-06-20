# Refactor Audit — SmartChat

## Phase Tracker
- [x] Phase 1: Shared Types Segregation
- [ ] Phase 2: Repository Interface Segregation
- [ ] Phase 3: Event Bus Abstraction
- [ ] Phase 4: Leaf Services
- [ ] Phase 5: Mid-Level Services
- [ ] Phase 6: Pipeline Orchestrators
- [ ] Phase 7: ServiceContainer Wiring

---

## Per-File Violation Report

## `src/main/services/whatsapp/types.ts`
Fan-in: Rank 1 (Highest)

**Responsibilities**
1. Defines type aliases and interfaces representing Baileys WhatsApp connection states, sockets, and client instances (`WASocket`, `SocketAccessor`, `BaileysSignalRepository`).
2. Defines DTOs and event payload structures parsed from raw Baileys packets (`ProtocolResult`, `BaileysMessage`, `ChatUpdatePayload`, `MessageReceiptUpdate`).
3. Defines parameter models for sending files/media through WhatsApp APIs (`MediaSendOptions`).

**SOLID Evaluation**
| Principle | Result | Notes |
|---|---|---|
| SRP | PASS | File only contains type and interface definitions. |
| OCP | PASS | |
| LSP | N/A | No inheritance. |
| ISP | PASS | |
| DIP | VIOLATION | Directly imports concrete `@whiskeysockets/baileys` structures and leaks internal socket details. |

**Violations**

### DIP — Leaking Third-Party Library Types
Symptom: Imports `makeWASocket` and `proto` directly from `@whiskeysockets/baileys`. Importers of these types are transitively coupled to Baileys' specific implementations.
Fix: Segregate internal Baileys library models into a dedicated infra adapter types layer, and expose clean, library-agnostic domain data types to the rest of the application services.
Effort: Low

---

## `src/main/utils.ts`
Fan-in: Rank 2

**Responsibilities**
1. Cleans and normalizes WhatsApp JIDs by stripping agent, port, or device suffixes (`cleanJid`).
2. Decodes Baileys specific timestamp formats to BigInt representations (`parseBaileysTimestamp`).
3. Evaluates, prioritizes, and unwraps raw Baileys messages to resolve their core content and types (`getMessageType`, `extractTextContent`, `unwrapMessage`).
4. Formats UI and last-message previews for the chat list (`getMessagePreviewLabel`).
5. Parses and maps raw chat payload metadata into community structures (`parseCommunityMetadata`).

**SOLID Evaluation**
| Principle | Result | Notes |
|---|---|---|
| SRP | VIOLATION | File handles multiple unrelated concerns (JID parsing, Baileys structures, UI previews, community parsing). |
| OCP | PASS | |
| LSP | N/A | No inheritance. |
| ISP | PASS | |
| DIP | VIOLATION | Directly couples utility functions to external `@whiskeysockets/baileys` models and internal `ChatUpdatePayload`. |

**Violations**

### SRP — Bloated General Utilities File
Symptom: General "dumping ground" for utility functions serving at least four distinct domains (identifiers, message extraction, UI display, community parsing).
Fix: Split the utility file into separate cohesive modules: `jidUtils.ts` (formatting/identifiers), `messageUtils.ts` (message structures), and `communityUtils.ts` (community-specific logic).
Effort: Medium

### DIP — Coupling Utilities to External Library Types
Symptom: Imports `proto` from `@whiskeysockets/baileys` and `ChatUpdatePayload` from `whatsapp/types` directly.
Fix: Make utilities accept generic/domain interfaces or move Baileys-dependent parsers to a low-level infra adapter utility module.
Effort: Low

---

## `src/main/services/whatsapp/IWAEventBus.ts`
Fan-in: Rank 3

**Responsibilities**
1. Defines the pub/sub event handler contract (`on`, `off`, `emit`, `removeAllListeners`) using typed event payloads.

**SOLID Evaluation**
| Principle | Result | Notes |
|---|---|---|
| SRP | PASS | Interface serves a single concern. |
| OCP | PASS | |
| LSP | N/A | No inheritance. |
| ISP | PASS | |
| DIP | PASS | |

---

## `src/main/services/contacts/IContactService.ts`
Fan-in: Rank 4

**Responsibilities**
1. Defines methods for managing and clearing memory cache states (`clearCaches`, `warmLinkCache`, `populateIdentityIdCache`).
2. Defines methods for resolving contact JIDs to user display names (`resolveName`, `batchResolveNames`).
3. Defines methods for creating or linking contacts and identities (`upsertContact`, `linkLidAndPn`, `registerMe`).
4. Defines database query operations for loading user identities (`batchGetIdentityIds`, `getIdentityIdByJid`, `resolveLidFromJid`, `findIdentityById`, `getMeJids`, `getMePhoneNumberJid`).

**SOLID Evaluation**
| Principle | Result | Notes |
|---|---|---|
| SRP | PASS | Interface definitions. |
| OCP | PASS | |
| LSP | N/A | No inheritance. |
| ISP | VIOLATION | Fat interface containing 13 methods serving multiple different client roles. |
| DIP | VIOLATION | Directly imports and references `WASocket` from low-level `whatsapp/types`. |

**Violations**

### ISP — Fat Service Interface
Symptom: Serves multiple different client roles (cache management, name resolution, identity syncing, user registration, and database querying) under a single broad contract.
Fix: Split into smaller interfaces: `IContactQueryService` (reads), `IContactMutationService` (writes), `IContactNameResolver` (resolving names), and `IContactCacheManager` (cache controls).
Effort: Medium

### DIP — Exposing External Socket Types in Contract
Symptom: Exposes low-level `WASocket` type from `@whiskeysockets/baileys` in public parameter signatures.
Fix: Remove `sock` parameter from interface methods. Let the implementation access socket states via an injected connection manager service.
Effort: Low

---

## `src/main/domain/types.ts`
Fan-in: Rank 5

**Responsibilities**
1. Defines internal domain-level representations of message records (`DBMessageWithSender`, `ProcessedMessage`).

**SOLID Evaluation**
| Principle | Result | Notes |
|---|---|---|
| SRP | PASS | File only contains domain types. |
| OCP | PASS | |
| LSP | N/A | No inheritance. |
| ISP | PASS | |
| DIP | PASS | |

---

## `src/main/services/chats/IChatRepository.ts`
Fan-in: Rank 6

**Responsibilities**
1. Defines the repository contract for reading chat rows, paginating, and searching chats (`findChatByJid`, `findChatsByJids`, `findChatsPaginated`, `searchChats`).
2. Defines write contracts for updating counters, timestamps, muting, and upserting chats (`upsertChat`, `updateChatUnreadCount`, `incrementUnread`, `updateTimestamp`, `bulkCreateChats`).

**SOLID Evaluation**
| Principle | Result | Notes |
|---|---|---|
| SRP | PASS | Interface definitions. |
| OCP | PASS | |
| LSP | N/A | No inheritance. |
| ISP | VIOLATION | Combines read queries, relational paginated retrievals, search logic, and write operations into a single interface. |
| DIP | VIOLATION | Imports and returns Prisma client entities directly in method definitions. |

**Violations**

### ISP — Combined Queries and Commands in Repository
Symptom: Exposes both read queries and write mutations in a single interface, forcing consumers of read-only logic to depend on mutation methods.
Fix: Segregate into `IChatReadRepository` and `IChatWriteRepository`.
Effort: Low

### DIP — Leaking ORM Client Entities
Symptom: Imports and returns `Chat` and `ChatWithCommunity` from `@prisma/client`.
Fix: Return domain-level Chat DTOs or clean interface definitions to avoid leaking Prisma models to services.
Effort: Low

---

## `src/main/services/messages/IMessageQueryRepository.ts`
Fan-in: Rank 7

**Responsibilities**
1. Defines query methods to load message content, retrieve text content, and check existence of IDs from the database.
2. Defines generic database access escape-hatches to execute raw parameterized SQL statements (`queryMessageIdsBySql`).

**SOLID Evaluation**
| Principle | Result | Notes |
|---|---|---|
| SRP | PASS | Interface definitions. |
| OCP | PASS | |
| LSP | N/A | No inheritance. |
| ISP | VIOLATION | Mixes structured domain queries with raw SQL execution methods and contains too many overlapping methods returning `any[]`. |
| DIP | VIOLATION | Directly references Prisma Client models in the interface contract. |

**Violations**

### ISP — Leaking Low-Level SQL Execution
Symptom: Exposes `queryMessageIdsBySql` which allows execution of raw SQL queries, leaking details of the database implementation to services.
Fix: Remove raw SQL execution methods from domain repositories; extract them to a specialized database adapter if required. Clean up overlapping methods.
Effort: Low

### DIP — Coupling to Prisma Model Definitions
Symptom: Exposes `@prisma/client` types (`Message`, `Identity`) directly in parameters and return signatures.
Fix: Return domain-level structures or custom agnostic data interfaces rather than raw Prisma client types.
Effort: Low

---

## `src/main/services/messages/formatters/MessageFormatter.ts`
Fan-in: Rank 8

**Responsibilities**
1. Defines the message type formatter strategy interface (`supports`, `format`) and context types.

**SOLID Evaluation**
| Principle | Result | Notes |
|---|---|---|
| SRP | PASS | Interface definitions. |
| OCP | PASS | Nicely designed for extension using strategy patterns. |
| LSP | N/A | No inheritance. |
| ISP | PASS | |
| DIP | VIOLATION | Imports and references `proto.IMessage` from `@whiskeysockets/baileys` directly. |

**Violations**

### DIP — Leaking Third-Party Message Types in Interface
Symptom: Exposes `proto.IMessage` from `@whiskeysockets/baileys` directly in the `format` method signature.
Fix: Define a decoupled, agnostic data shape or serializable parameter representing message content instead of passing low-level Baileys structures.
Effort: Low

---

## `src/main/services/contacts/IIdentityRepository.ts`
Fan-in: Rank 9

**Responsibilities**
1. Defines standard CRUD operations for contact identities (`createIdentity`, `updateIdentity`, `deleteIdentity`).
2. Defines domain-level checks for counting references and searching identities (`countIdentityReferences`, `searchIdentities`).

**SOLID Evaluation**
| Principle | Result | Notes |
|---|---|---|
| SRP | PASS | Interface definitions. |
| OCP | PASS | |
| LSP | N/A | No inheritance. |
| ISP | VIOLATION | Combines write commands, reference counting checks, search queries, and identity queries into one contract. |
| DIP | VIOLATION | Directly imports and returns Prisma Client types. |

**Violations**

### ISP — Bloated Identity Repository
Symptom: Combines standard CRUD write operations with database reference/integrity checks and full-text searches.
Fix: Segregate into `IIdentityQueryRepository` and `IIdentityWriteRepository`.
Effort: Low

### DIP — Leaking ORM Types
Symptom: Imports `Identity` and `IdentityAlias` from `@prisma/client` directly.
Fix: Map ORM client objects to domain-level shapes inside the concrete repository layer and return domain interfaces.
Effort: Low

---

## `src/main/services/contacts/ContactService.ts`
Fan-in: Rank 10

**Responsibilities**
1. Instantiates and stores JID strategies (`PnJidStrategy`, `LidJidStrategy`, etc.) to classify phone numbers and group chats.
2. Coordinates low-level memory and set caching keys for mappings (`linkCache`, `identityIdCache`, `meJidsCache`).
3. Orchestrates name resolution and batch resolution by wrapping `ContactNameResolver` operations.
4. Implements complex sync/creation workflows to reconcile identities and link LIDs and PNs via repositories.
5. Registers the logged-in user profile, marking identities as `isMe`.

**SOLID Evaluation**
| Principle | Result | Notes |
|---|---|---|
| SRP | VIOLATION | Bloated class managing strategies, caches, name resolution, and database synchronization. |
| OCP | VIOLATION | Hardcoded instantiation of concrete strategy classes inside the service body. |
| LSP | N/A | No inheritance. |
| ISP | PASS | |
| DIP | VIOLATION | Depends on concrete helper classes, instantiates strategies directly, and references low-level socket and ORM types. |

**Violations**

### SRP — Bloated Contact Management Service
Symptom: Heavily bloated service (467 lines) combining caching coordination, JID strategy execution, user identity mapping, registration orchestration, and database query/CRUD proxying.
Fix: Delegate cache management to a dedicated class/helper; extract registration workflow; register JID strategies via DI rather than hardcoding.
Effort: Medium

### OCP — Hardcoded JID Strategy Registrations
Symptom: Instantiates `strategies` array statically in class initialization (`new PnJidStrategy()`, etc.). Adding new JID formats requires modifying the class.
Fix: Inject an array of JID strategies (`IJidStrategy[]`) through the constructor.
Effort: Low

### DIP — Rigid Concrete Dependencies and Socket Types
Symptom: Concrete class dependencies on `LidPnLinker` and `ContactNameResolver` in constructor instead of interfaces. References low-level `WASocket` and `@prisma/client` types in parameters and returns.
Fix: Depend on interfaces `ILidPnLinker` and `IContactNameResolver`; decouple method parameters from `WASocket` types.
Effort: Medium

---

## `src/main/services/contacts/IAliasRepository.ts`
Fan-in: Rank 11

**Responsibilities**
1. Defines read and write contracts to manage, look up, and link WhatsApp JIDs to canonical identity rows.

**SOLID Evaluation**
| Principle | Result | Notes |
|---|---|---|
| SRP | PASS | Interface definitions. |
| OCP | PASS | |
| LSP | N/A | No inheritance. |
| ISP | VIOLATION | Exposes Prisma models in return types and mixes read queries with write operations. |
| DIP | VIOLATION | Imports `Identity` and `IdentityAlias` from `@prisma/client`. |

**Violations**

### ISP — Combined Reads and Writes in Alias Contract
Symptom: Mixes read queries (`findIdentityAlias`, etc.) with write operations (`upsertIdentityAlias`) and exposes low-level ORM shapes.
Fix: Expose plain domain DTO interfaces instead of Prisma model structures; split read and write contracts.
Effort: Low

### DIP — Coupling to Prisma Model Schema
Symptom: Directly references `Identity` and `IdentityAlias` from `@prisma/client`.
Fix: Map ORM database types to domain types inside the repository implementation.
Effort: Low

---

## `src/main/services/messages/IMessageRepository.ts`
Fan-in: Rank 12

**Responsibilities**
1. Defines database write contracts for creating, updating, syncing, and revoking WhatsApp messages.
2. Defines complex read-after-write methods that retrieve updated rows with relations (`updateAndFetchMessageWithSender`).

**SOLID Evaluation**
| Principle | Result | Notes |
|---|---|---|
| SRP | PASS | Interface definitions. |
| OCP | PASS | |
| LSP | N/A | No inheritance. |
| ISP | VIOLATION | Mixes write-only commands with complex data-fetch queries that return relations. |
| DIP | VIOLATION | Directly references Prisma Client model types. |

**Violations**

### ISP — Compound Write and Read Operations
Symptom: Mixes write-only commands with complex data-fetch queries (`updateAndFetchMessageWithSender`) returning relational models.
Fix: Segregate write commands into a clean repository and move the read/fetch operations to a query service or read repository.
Effort: Low

### DIP — Leaking Prisma Models to Service Layer
Symptom: Directly references `Message` and `Identity` from `@prisma/client`.
Fix: Define and return domain message interfaces instead of ORM database types.
Effort: Low

---

## `src/main/services/messages/IReactionRepository.ts`
Fan-in: Rank 13

**Responsibilities**
1. Defines write operations (`upsertReaction`, `deleteReactions`, `bulkSyncReactions`) for storing user emoji selections.
2. Defines read queries to fetch reaction stats for messages and the last reaction in a chat (`findReactionsForMessages`, `findLastReaction`).

**SOLID Evaluation**
| Principle | Result | Notes |
|---|---|---|
| SRP | PASS | Interface definitions. |
| OCP | PASS | |
| LSP | N/A | No inheritance. |
| ISP | VIOLATION | Mixes write commands with read query methods. |
| DIP | PASS | Uses clean data objects in contracts. |

**Violations**

### ISP — Mixing Command and Query Concerns
Symptom: Exposes both write mutations (`upsertReaction`) and read queries (`findLastReaction`) in a single repository contract.
Fix: Segregate into query and write/command interfaces.
Effort: Low

---

## `src/main/services/ai/AIToolService.ts`
Fan-in: Rank 14

**Responsibilities**
1. Coordinates registering and retrieving available AI tools (`registerTool`, `getTool`, `getAllTools`, `getToolDefinitions`).
2. Assembles system instruction prompts containing tool definitions by delegating to a prompt builder (`getSystemInstructions`).
3. Exports a global concrete singleton instance `toolRegistry`.

**SOLID Evaluation**
| Principle | Result | Notes |
|---|---|---|
| SRP | VIOLATION | Combines tool registration registry responsibilities with formatting/compiling prompt strings. |
| OCP | PASS | |
| LSP | PASS | |
| ISP | PASS | |
| DIP | VIOLATION | Hardcoded concrete dependency on static class methods. Exports global singleton instance. |

**Violations**

### SRP — Mixing Registry and Prompt Building Logic
Symptom: Class handles both registry management and formatting prompt strings by delegating to `SystemPromptBuilder`.
Fix: Move system prompt compilation to a dedicated prompt generation service; registry should only hold tool definitions.
Effort: Medium

### DIP — Concrete Static Dependency and Global Singletons
Symptom: Hardcoded concrete dependency on `SystemPromptBuilder.build` static call. Exports a global singleton `toolRegistry` instead of allowing the DI container to manage lifecycle.
Fix: Inject a prompt builder interface, and let `ServiceContainer` manage tool service instantiation and scope.
Effort: Low

---

## `src/main/ipc/types.ts`
Fan-in: Rank 15

**Responsibilities**
1. Defines serialization formats and interfaces for IPC communication with the frontend (`EnrichedMessage`, `ChatListItem`, `EnrichedReaction`).

**SOLID Evaluation**
| Principle | Result | Notes |
|---|---|---|
| SRP | PASS | File only contains IPC types. |
| OCP | PASS | |
| LSP | N/A | No inheritance. |
| ISP | PASS | |
| DIP | PASS | |

---

## `src/main/services/whatsapp/WAEventTypes.ts`
Fan-in: Rank 16

**Responsibilities**
1. Re-exports individual event categories and maps event names to their corresponding event payload models.

**SOLID Evaluation**
| Principle | Result | Notes |
|---|---|---|
| SRP | PASS | File only contains event map and re-exports. |
| OCP | PASS | |
| LSP | N/A | No inheritance. |
| ISP | PASS | |
| DIP | PASS | |

---

## `src/main/services/ai/IAIKeyService.ts`
Fan-in: Rank 17

**Responsibilities**
1. Defines the contract for fetching and saving API keys for AI model providers (`getKeys`, `getKey`, `saveKey`).

**SOLID Evaluation**
| Principle | Result | Notes |
|---|---|---|
| SRP | PASS | Interface definitions. |
| OCP | VIOLATION | Has hardcoded field names for AI providers in `ProviderKeys`. |
| LSP | N/A | No inheritance. |
| ISP | PASS | |
| DIP | PASS | |

**Violations**

### OCP — Hardcoded Provider Key Definitions
Symptom: Has hardcoded field names (`gemini`, `groq`, `mistral`, `deepseek`) in `ProviderKeys` interface. Adding a provider requires modifying this interface.
Fix: Change the key lookup structure to use open-ended indexing, such as `Record<string, string>`.
Effort: Low

---

## `src/main/services/messages/IMessageQueryService.ts`
Fan-in: Rank 18

**Responsibilities**
1. Defines methods for checking special message attributes and parsing message payloads (`isSpecialMessage`, `parseMessageSync`).
2. Defines methods for loading and enriching chat message histories for the UI (`getChatMessages`, `enrichMessage`).
3. Defines helpers for formatting safe filesystem media names (`getSafeMediaFileName`).

**SOLID Evaluation**
| Principle | Result | Notes |
|---|---|---|
| SRP | PASS | Interface definitions. |
| OCP | PASS | |
| LSP | N/A | No inheritance. |
| ISP | VIOLATION | Fat interface combining text-parsing helper logic, database history retrieval, serialization enrichment, and file name generation. |
| DIP | VIOLATION | Directly imports and references concrete types and low-level Baileys socket types. |

**Violations**

### ISP — Fat Message Query Service Contract
Symptom: Combines query, parsing, enrichment, and filename formatting methods in a single interface.
Fix: Segregate into distinct interfaces: `IMessageQueryService` (retrieval), `IMessageParser` (decoding/type-checking), and `IMediaFileResolver` (media paths).
Effort: Medium

### DIP — Leaking Low-Level Socket and Concrete Parser Types
Symptom: Directly imports and references concrete types (`ParsedMessage` from `./MessageParser`) and low-level Baileys socket types (`WASocket`, `BaileysMessage`).
Fix: Decouple from low-level library and concrete service types; define abstraction models for inputs.
Effort: Low

---

## `src/main/services/messages/IMessageWriterService.ts`
Fan-in: Rank 19

**Responsibilities**
1. Defines contracts for processing and syncing incoming message structures, edits, and revokes to the database.

**SOLID Evaluation**
| Principle | Result | Notes |
|---|---|---|
| SRP | PASS | Interface definitions. |
| OCP | PASS | |
| LSP | N/A | No inheritance. |
| ISP | PASS | Interface is cohesive around writing operations. |
| DIP | VIOLATION | Directly imports and accepts low-level Baileys event structures and socket classes in all parameter lists. |

**Violations**

### DIP — Exposing Baileys Payload Formats in Writer contract
Symptom: Parameter lists require Baileys-specific types (`BaileysMessage`, `ProtocolResult`, `BaileysReactionUpdate`, `WASocket`), binding all message writers to Baileys' schemas.
Fix: Define custom DTO/domain types to isolate message writes from Baileys-specific objects.
Effort: Low

---

## `src/main/services/search/EmbeddingService.ts`
Fan-in: Rank 20

**Responsibilities**
1. Manages spawning and messaging a background worker thread (`worker_threads` `Worker`) for embedding computations.
2. Coordinates queues, indexing status, pause states, and active state callbacks.
3. Implements bulk index orchestration by loading messages and invoking embeddings.
4. Validates dimension counts and updates vector tables inside the database.

**SOLID Evaluation**
| Principle | Result | Notes |
|---|---|---|
| SRP | VIOLATION | Mixes background thread worker lifecycle management, file system path resolving, vector queue/pause logic, and database operations. |
| OCP | PASS | |
| LSP | N/A | No inheritance. |
| ISP | PASS | |
| DIP | VIOLATION | Directly instantiates Node `Worker` class in methods, depends on global Electron `app` functions, and contains magic config strings. |

**Violations**

### SRP — Combined Process Management and Embedding Orchestration
Symptom: Class handles low-level worker lifecycle, electron path resolution, queue management, and vector repository index operations in one class.
Fix: Move background worker management to a separate `WorkerClient`; delegate folder path resolving to a config provider; keep `EmbeddingService` focused on business orchestrations.
Effort: Medium

### DIP — Direct Instantiation of Workers and Global Electron Imports
Symptom: Directly instantiates node `Worker` class in methods. Depends on global Electron `app` functions. Hardcodes default settings.
Fix: Inject a worker client factory and a configuration options interface.
Effort: Medium

---

## `src/main/services/whatsapp/subscribers/IWAEventSubscriber.ts`
Fan-in: Rank 21

**Responsibilities**
1. Defines the event subscriber lifecycle contract (`register`, `dispose`) for wire-up classes.

**SOLID Evaluation**
| Principle | Result | Notes |
|---|---|---|
| SRP | PASS | Interface serves a single concern. |
| OCP | PASS | |
| LSP | N/A | No inheritance. |
| ISP | PASS | |
| DIP | PASS | |

---

## `src/main/services/chats/IChatService.ts`
Fan-in: Rank 22

**Responsibilities**
1. Defines contracts for syncing chat data, toggling read states, checking mute states, and updating timestamps (`upsertChat`, `markRead`, `incrementUnread`, `updateTimestamp`).
2. Defines contracts for loading enriched chat histories and group participants (`getChatList`, `getGroupParticipants`).

**SOLID Evaluation**
| Principle | Result | Notes |
|---|---|---|
| SRP | PASS | Interface definitions. |
| OCP | PASS | |
| LSP | N/A | No inheritance. |
| ISP | VIOLATION | Combines read queries, mutation operations, and group participant resolutions in a single contract. |
| DIP | VIOLATION | References low-level socket types and frontend IPC data contracts directly in method definitions. |

**Violations**

### ISP — Combined Chat Query, Mutation, and Participant Operations
Symptom: Exposes read methods, mutation commands, and participant fetching under the same service contract.
Fix: Segregate into `IChatQueryService`, `IChatMutationService`, and `IGroupParticipantResolver`.
Effort: Low

### DIP — Leaking External and Frontend Types in Contract
Symptom: References low-level socket types (`WASocket`, `ChatUpdatePayload`) and frontend IPC data contracts (`ChatListItem`) directly in method definitions.
Fix: Decouple parameters from Baileys classes and UI-bound structures.
Effort: Low

---

## `src/main/services/chats/ICommunityRepository.ts`
Fan-in: Rank 23

**Responsibilities**
1. Defines mutations (`upsertCommunity`, `updateCommunityAnnounceJid`) for community mapping records.

**SOLID Evaluation**
| Principle | Result | Notes |
|---|---|---|
| SRP | PASS | Interface definitions. |
| OCP | PASS | |
| LSP | N/A | No inheritance. |
| ISP | PASS | |
| DIP | VIOLATION | Imports and returns Prisma client `Community` model directly. |

**Violations**

### DIP — Leaking Prisma Models to Service Interfaces
Symptom: Imports and returns Prisma client `Community` model directly.
Fix: Define and return domain-level Community models or plain interfaces.
Effort: Low

---

## `src/main/ServiceContainer.ts`
Fan-in: Rank 24

**Responsibilities**
1. Instantiates all repository classes with the database client.
2. Instantiates and links services, resolving their concrete dependencies.
3. Houses the public `ServiceContainer` type definition and returns the container map.

**SOLID Evaluation**
| Principle | Result | Notes |
|---|---|---|
| SRP | VIOLATION | Single module orchestrating constructor instantiation of over 30 classes AND defining type registrations. |
| OCP | PASS | |
| LSP | N/A | No inheritance. |
| ISP | PASS | |
| DIP | VIOLATION | Maps registry keys in the `ServiceContainer` type to concrete classes instead of interface abstractions. |

**Violations**

### SRP — Overloaded Bootstrapper File
Symptom: Class is 270 lines long, instantiating every concrete service and repository in the app and typing the container to these concrete classes.
Fix: Keep this as the DI bootstrap root, but map keys to abstractions rather than concrete classes.
Effort: Medium

### DIP — Coupling Container Keys to Concrete Services
Symptom: Maps registry keys in the `ServiceContainer` type to concrete classes (e.g. `aiService: AIService`, `searchService: SearchService`, etc.) instead of interface abstractions.
Fix: Map every service key in the container to its interface definition, and bind concrete classes to interfaces during setup.
Effort: Medium

---

## `src/main/services/ai/providers/Provider.ts`
Fan-in: Rank 25 (Lowest)

**Responsibilities**
1. Defines types for AI model models (`ModelInfo`) and provider adapter interfaces (`AIProvider`).

**SOLID Evaluation**
| Principle | Result | Notes |
|---|---|---|
| SRP | PASS | File only contains type definitions and interfaces. |
| OCP | VIOLATION | Hardcoded string union of providers in `ModelInfo`. |
| LSP | N/A | No inheritance. |
| ISP | PASS | Interface is cohesive. |
| DIP | PASS | |

**Violations**

### OCP — Hardcoded Model Providers
Symptom: `ModelInfo` has a union type `provider` with hardcoded string literals `'gemini' | 'lmstudio' | 'groq' | 'mistral' | 'deepseek'`. Adding a provider breaks OCP.
Fix: Generalize the `provider` property type to `string`.
Effort: Low

---

## Phase-Wise Refactoring Plan

## Phase 1: Shared Types Segregation
**Objective:** Remove the monolithic types file(s) that every layer imports and segregate external client types.
**Files in scope:**
- `src/main/services/whatsapp/types.ts`
- `src/main/services/whatsapp/WAEventTypes.ts`
- `src/main/domain/types.ts`
- `src/main/ipc/types.ts`
- `src/main/utils.ts`
**What changes:**
- Split `types.ts` into layer-specific files: separate internal Baileys types from clean domain types.
- Decouple utilities in `src/main/utils.ts` by splitting into separate cohesive files (`jidUtils.ts`, `messageUtils.ts`, `communityUtils.ts`) and removing direct dependency on Baileys socket types.
- Split `WAEventTypes.ts` into individual sub-event files if required to isolate domain concepts.
**Completed:** 2026-06-20 — Files changed: 2 (types.ts, utils.ts). Files created: 4 (whatsapp.types.ts, jidUtils.ts, messageUtils.ts, communityUtils.ts). Blockers: none.


## Phase 2: Repository Interface Segregation
**Objective:** Split fat repository interfaces so consumers only depend on what they use, and remove direct imports of Prisma ORM types.
**Files in scope:**
- `src/main/services/chats/IChatRepository.ts`
- `src/main/services/messages/IMessageQueryRepository.ts`
- `src/main/services/contacts/IContactService.ts` (queries / mutations segregation)
- `src/main/services/contacts/IIdentityRepository.ts`
- `src/main/services/contacts/IAliasRepository.ts`
- `src/main/services/messages/IMessageRepository.ts`
- `src/main/services/messages/IReactionRepository.ts`
- `src/main/services/chats/ICommunityRepository.ts`
**What changes:**
- Segregate read query operations and write command operations for all repositories (e.g. `IChatReadRepository` vs `IChatWriteRepository`).
- Remove ORM type dependencies from interface definitions and replace them with plain domain interfaces or DTOs.
**Verification:** `npx tsc --noEmit` returns zero errors

## Phase 3: Event Bus Abstraction
**Objective:** Decouple all event-driven services from the concrete EventBus class.
**Files in scope:**
- `src/main/services/whatsapp/IWAEventBus.ts`
- `src/main/services/whatsapp/subscribers/IWAEventSubscriber.ts`
**What changes:**
- Ensure all event subscribers depend strictly on the `IWAEventBus` interface and do not reference the concrete `WAEventBus` class.
- Verify event mapping keys are fully decoupled from Baileys-specific events.
**Verification:** `npx tsc --noEmit` returns zero errors

## Phase 4: Leaf Services
**Objective:** Fix SRP and DIP in leaf-level services (no other services depend on them).
**Files in scope:**
- `src/main/services/search/EmbeddingService.ts`
- `src/main/services/ai/IAIKeyService.ts`
- `src/main/services/messages/formatters/MessageFormatter.ts`
**What changes:**
- Extract worker thread lifecycle management out of `EmbeddingService` into an injected worker manager client. Inject path configurations.
- Generalize AI model provider keys into open dictionary records (`Record<string, string>`) to support extensibility.
- Decouple formatters from external Baileys message shapes.
**Verification:** `npx tsc --noEmit` returns zero errors

## Phase 5: Mid-Level Services
**Objective:** Fix SRP, OCP, and DIP in mid-level orchestrators.
**Files in scope:**
- `src/main/services/contacts/IContactService.ts`
- `src/main/services/contacts/ContactService.ts`
- `src/main/services/chats/IChatService.ts`
- `src/main/services/ai/AIToolService.ts`
- `src/main/services/ai/providers/Provider.ts`
**What changes:**
- Extract JID strategies from `ContactService` and inject them as an array; move cache management out of `ContactService`.
- Segregate `IChatService` into query, mutation, and participant resolution interfaces.
- Separate AI tool registry coordination from system prompt formatting logic, and remove static builder calls.
- Decouple model info from hardcoded lists of providers.
**Verification:** `npx tsc --noEmit` returns zero errors

## Phase 6: High-Level Pipeline Orchestrators
**Objective:** Refactor the highest-complexity coordinators (message synchronization and parsing pipeline).
**Files in scope:**
- `src/main/services/messages/IMessageQueryService.ts`
- `src/main/services/messages/IMessageWriterService.ts`
**What changes:**
- Segregate `IMessageQueryService` and `IMessageWriterService` interfaces to isolate message parsing, database reading, media metadata resolution, and database writes.
- Remove external socket dependencies (`WASocket`, `BaileysMessage`) from service contracts.
**Verification:** `npx tsc --noEmit` returns zero errors

## Phase 7: ServiceContainer Wiring
**Objective:** Bind all container keys to interface types, not concrete classes.
**Files in scope:**
- `src/main/ServiceContainer.ts`
**What changes:**
- Update `ServiceContainer` type registry definition so all keys map to interface abstractions (e.g. `IAIService`, `ISearchService`, `IHistorySyncManager`).
- Bind concrete class instances to their corresponding interfaces during bootstrapping in `createServices`.
- Ensure no caller code directly imports or depends on concrete service/repository implementations.
**Verification:** `npx tsc --noEmit` returns zero errors
