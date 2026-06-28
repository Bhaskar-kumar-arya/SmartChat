# Architecture Decision Records (ADR) — SmartChat

This document records the major architectural decisions made during the SmartChat codebase refactoring pipeline, capturing the context, decisions, and consequences.

---

## ADR-1: Types & Utilities Segregation

**Date:** 2026-06-20
**Status:** Accepted

### Context
Monolithic types coupled UI components, domain logic, and Baileys types. Simple helper imports transitively loaded heavy SDK dependencies.

### Decision
Segregate types and utilities. Split main process types into `whatsapp.types.ts` and domain `entities.ts`/`db.types.ts`. Split renderer types into granular modules. Enforce direct utility imports.

### Consequences
**Enables:** Clear layer boundaries, smaller compile scopes, and easier unit testing.
**Constrains:** Services/UI must not import SDK-specific or presentation-only types.
**Watch for:** Static type leaks in utility modules.

---

## ADR-2: Repository Interface Segregation & ORM Isolation

**Date:** 2026-06-20 (Updated 2026-06-21)
**Status:** Accepted

### Context
Repository interfaces (e.g. `IChatRepository`) mixed read/write actions, used generic `any` for ORM queries, and leaked Prisma models directly to services.

### Decision
Apply Interface Segregation Principle (ISP) to repository interfaces, separating read and write contracts. Centralize Prisma access inside repositories, return clean domain DTOs, and type queries explicitly (`MessageQueryFilter`).

### Consequences
**Enables:** Isolation of services from DB schema changes and direct mockability.
**Constrains:** Services must never import Prisma Client or entities directly.
**Watch for:** Bypassing interfaces to run raw SQL queries.

---

## ADR-3: Event Bus Abstraction

**Date:** 2026-06-20
**Status:** Accepted

### Context
Event-driven services directly depended on the concrete `WAEventBus` class, which coupled connection handlers, sync modules, and chat services to one event implementation.

### Decision
Introduce the `IWAEventBus` interface representing the pub/sub event handler contract. Instantiate the bus via the DI container.

### Consequences
**Enables:** Decoupling event wiring, allowing easy mocking of the event bus during testing.
**Constrains:** All subscribers and publishers must consume the `IWAEventBus` interface.
**Watch for:** Memory leaks due to undeleted listeners or event loops.

---

## ADR-4: WhatsApp Transport Type Isolation

**Date:** 2026-06-21
**Status:** Accepted

### Context
Raw Baileys library types (e.g. `proto.IMessageKey`, `proto.IMessage`) leaked through the event bus and service interfaces, making the codebase highly vulnerable to library updates.

### Decision
Introduce domain wrapper types (`WAMessageKey`, `WAMessageContent`) and map raw socket payloads at the adapter boundary before publishing to the event bus.

### Consequences
**Enables:** Complete isolation of core services from Baileys SDK internal data shapes.
**Constrains:** Services must never import or reference the Baileys `proto` namespace.
**Watch for:** New raw Baileys types leaking back into domain objects.

---

## ADR-5: Utility Barrel Direct Import Enforcement

**Date:** 2026-06-21
**Status:** Accepted

### Context
The monolithic `utils.ts` barrel combined JID normalizers, message parsing, and community helpers, coupling lightweight utility consumers to heavy libraries.

### Decision
Enforce direct imports of specific utility files (e.g. `utils/jidUtils`, `utils/messageUtils`) and deprecate the common `utils.ts` barrel.

### Consequences
**Enables:** Clean dependency paths and reduced compilation blast radius.
**Constrains:** Core services must import directly from specific sub-utility files.
**Watch for:** Developers reintroducing barrel exports for convenience.

---

## ADR-6: AI Interface Segregation and Type Safety

**Date:** 2026-06-21
**Status:** Accepted

### Context
`IBaseAIProvider` mixed streaming and full-response generation, forcing single-mode providers to override empty stubs. Tool prompt builders bypassed type safety via `any[]`.

### Decision
Split `IBaseAIProvider` into capability-specific interfaces (`IStreamingProvider`, `IFullResponseProvider`). Extract `IApiKeyAwareProvider` and strongly type tool lists to `AITool[]`.

### Consequences
**Enables:** Clean provider implementations without stub overrides and type-safe prompt building.
**Constrains:** Registered tools must implement the `AITool` contract.
**Watch for:** Bypassing registry validation or using untyped prompts.

---

## ADR-7: Embedding Service Interface Segregation

**Date:** 2026-06-21
**Status:** Accepted

### Context
Monolithic `IEmbeddingService` combined vector computation, worker thread lifecycles, database synchronization, and model configuration under one contract.

### Decision
Split `IEmbeddingService` into four specific interfaces: `IEmbeddingComputer`, `IMessageIndexer`, `IEmbeddingModelConfig`, and `IEmbeddingOperationalControl`.

### Consequences
**Enables:** Fine-grained client dependencies; `SearchService` only consumes `IEmbeddingComputer`.
**Constrains:** Constructors must request the narrowest sub-interface instead of the combined rollup.
**Watch for:** Re-combining distinct responsibilities into a single interface.

---

## ADR-8: Contact Service Interface Segregation & Injection Narrowing

**Date:** 2026-06-21
**Status:** Accepted

### Context
Monolithic `IContactService` rollup had 14 methods and leaked the raw Baileys `WASocket` type in method parameters, violating domain-boundary rules.

### Decision
Split `IContactService` into `IContactQueryService`, `IContactMutationService`, `IContactNameResolver`, and `IContactCacheManager`. Replace `WASocket` parameters with `ISocketUserContext` and `IMediaSocket`.

### Consequences
**Enables:** Domain-driven contact resolution free from socket references.
**Constrains:** Constructor injection must declare the narrowest sub-interface.
**Watch for:** Accidentally passing raw socket connections instead of context.

---

## ADR-9: Chat Service Transport Decoupling

**Date:** 2026-06-21
**Status:** Accepted

### Context
The chat service boundary directly imported `SocketAccessor` and `ChatUpdatePayload` from the WhatsApp transport module, coupling domain logic to network libraries.

### Decision
Move `ChatUpdatePayload` to `domain/whatsapp.types.ts`. Introduce `IGroupMetadataFetcher` in the chat domain to resolve members, keeping sockets inside implementation classes.

### Consequences
**Enables:** Decoupling chat domain CRUD operations from connection lifecycles.
**Constrains:** Sockets must not leak beyond concrete implementation files.
**Watch for:** Re-introducing socket accessors inside chat repositories.

---

## ADR-10: Open-Closed Message Formatter Strategy & Registry

**Date:** 2026-06-22
**Status:** Accepted

### Context
`IFormattedMessageContent` explicitly declared every known WhatsApp content type. Adding a new formatter required modifying this shared interface, violating OCP.

### Decision
Replace `IFormattedMessageContent` with `Record<string, any>` (narrowed locally in formatters). Register concrete formatters dynamically in `MessageFormatterRegistry`.

### Consequences
**Enables:** Adding new formatters without modifying any shared files (strict OCP).
**Constrains:** Formatters must narrow types locally with self-contained schemas.
**Watch for:** Runtime type assertion failures due to missing property checks.

---

## ADR-11: WhatsApp Event Map Domain Composition

**Date:** 2026-06-22
**Status:** Accepted

### Context
Monolithic `WAEventMap` registry triggered broad recompilations of all event subscribers when any connection or sync event changed.

### Decision
Group events into domain interfaces (`MessageEventMap`, `ChatEventMap`, etc.) and compose `WAEventMap` via type intersection inside `WAEventTypes.ts`.

### Consequences
**Enables:** Domain changes only compile corresponding subscriber files, minimizing blast radius.
**Constrains:** Event keys must be unique across all maps to prevent collisions.
**Watch for:** Key collisions between distinct domain modules.

---

## ADR-12: Renderer Composition Root Decoupling

**Date:** 2026-06-22
**Status:** Accepted

### Context
React's `APIProvider` directly imported and instantiated the concrete `api` singleton, preventing mock client injection during unit testing and Storybook preview.

### Decision
Decouple `APIContext.tsx` from concrete service instances. Let `APIProvider` accept `IAPIService` as a prop, wired at the Composition Root (`main.tsx`).

### Consequences
**Enables:** Swapping the API client layer for mock structures during UI testing.
**Constrains:** React components must never import from the concrete `api.service` directly.
**Watch for:** Bypassing context hook to import concrete services.

---

## ADR-13: Local HTTP API Server Integration

**Date:** 2026-06-23
**Status:** Accepted

### Context
External local applications/scripts had no way to consume SmartChat's features (such as sending/reading messages and database querying via registered tools).

### Decision
Introduce a lightweight local HTTP API server (`APIServer`) running in the main process. Use Node's built-in `http` module to minimize external dependencies. Secure requests with a dynamically generated Bearer Token authorization schema, and restrict listening to `127.0.0.1` (localhost). Expose endpoints for direct tool execution, sending messages, and querying connection status/chats.

### Consequences
**Enables:** Secure, low-overhead integration for external programs to interact with SmartChat's database and WhatsApp client.
**Constrains:** All external calls must provide the `Authorization: Bearer <token>` header. Tools executed via the API bypass manual UI approvals because the caller is pre-authenticated.
**Watch for:** Resource exhaustion if an external client spawns excessive parallel requests.

---

## ADR-14: WhatsApp Engine Background Worker Offloading

**Date:** 2026-06-28
**Status:** Accepted

### Context
Running the WhatsApp socket connection (via Baileys) and writing/syncing historical database entries directly on the Electron Main process caused noticeable CPU spikes and event loop delays. This led to temporary UI lags/freezes during high-throughput sync phases due to resource contention.

### Decision
Offload the Baileys network/decryption logic, message parsing, and database write transactions to a dedicated background Node.js worker thread (`whatsapp.worker.ts`). Communication between the Main process and the worker thread is handled via `parentPort` messages managed by a bridge class (`WAWorkerBridge.ts`). To prevent `DataCloneError` crashes over worker boundaries, strip non-serializable objects (like the raw socket instance closures) from event payloads and sanitize boom errors before transmission, re-injecting the bridge proxy as the socket context on the Main process side.

### Consequences
**Enables:** Smooth, lag-free UI rendering during initial syncs and heavy incoming message traffic by keeping the main thread's event loop clear.
**Constrains:** All interaction with the WhatsApp client from the Main process must go through the command-sending API of `WAWorkerBridge`. Payloads sent over the worker boundary must be clean, serializable, and free of closures or complex classes.
**Watch for:** Sync latency or serialization bottlenecks on massive object structures.


