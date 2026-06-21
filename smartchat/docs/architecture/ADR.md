# Architecture Decision Records (ADR) — SmartChat

This document records the major architectural decisions made during the SmartChat codebase refactoring pipeline, capturing the context, decisions, and consequences.

---

## ADR-1: Types & Utilities Segregation (Main & Renderer)

**Date:** 2026-06-20
**Status:** Accepted

### Context
Monolithic type files (like `types.ts` in main and renderer) coupled UI components, domain definitions, and third-party libraries (e.g., Baileys). Importers of simple utility helpers (like `cleanJid`) were transitively coupled to heavy dependencies, complicating compilation and testing.

### Decision
Segregate monolithic types and utilities into layer-focused modules. Split main process types into Baileys-specific (`whatsapp.types.ts`) and clean domain types (`types.ts`). Split renderer types into granular modules (`chatTypes.ts`, `aiTypes.ts`, `mediaTypes.ts`, `componentProps.ts`), and extract formatting helpers into standalone utilities (like `contactUtils.ts`).

### Consequences
**Enables:**
- Layer isolation between raw network protocols, internal utilities, and UI layout code.
- Granular compile scopes and easier unit testing of utilities without loading socket libraries.

**Constrains:**
- Core services and UI components must never import library-specific or presentation-only types.
- Main-process utilities must not import `@whiskeysockets/baileys` directly.

**Watch for:**
- Static type leaks when creating new utility helpers or component props.

---

## ADR-2: Repository Interface Segregation & ORM Isolation

**Date:** 2026-06-20 (Updated 2026-06-21)
**Status:** Accepted

### Context
Database repository interfaces (e.g., `IChatRepository`, `IMessageRepository`) mixed read operations with mutating write operations and directly leaked Prisma models to services. Furthermore, query methods used raw `any` parameters for Prisma query filters, compromising type safety.

### Decision
Apply the Interface Segregation Principle (ISP) to split repository interfaces into narrow, read-only and write-only contracts (e.g., `IMessageExistenceRepository`, `IMessageReadRepository`, `IMessageSearchRepository`, `IMessageIndexRepository`, and `IMessageCompoundRepository`). Map ORM model entities to clean domain DTOs inside repositories, and replace open `where: any` parameters with explicit typed filters (`MessageQueryFilter`).

### Consequences
**Enables:**
- Compliance with ISP — services only declare dependencies on the query types they actually invoke.
- Complete isolation of the service layer from database schema changes.
- Direct mockability for unit testing service orchestrations without database setups.

**Constrains:**
- Services must never import Prisma models or Client objects directly.
- Complex relationship lookups must be mapped to explicit domain DTO types.

**Watch for:**
- "Quick query" bypasses in service files or methods returning untyped `any`.

---

## ADR-3: Event Bus Abstraction

**Date:** 2026-06-20
**Status:** Accepted

### Context
Event-driven services directly imported and depended on the concrete `WAEventBus` class. This tightly bound connection handlers, history sync, and chat services to one event implementation, preventing modular testing.

### Decision
Introduce the `IWAEventBus` interface representing the pub/sub event handler contract, and instantiate the event bus using `WAEventBusFactory`. All subscribers and publishers depend strictly on this abstraction.

### Consequences
**Enables:**
- Mocking or replacing the event bus during integration and unit tests.
- Decoupling event subscriber wire-up from event bus internals.

**Constrains:**
- Concrete event classes must not be imported across layer boundaries.
- Subscribers must only consume `IWAEventBus`.

**Watch for:**
- Event loops caused by direct cross-dependencies inside subscribers.

---

## ADR-4: Service Layer Decoupling & Transport Isolation

**Date:** 2026-06-20 (Updated 2026-06-21)
**Status:** Accepted

### Context
Core services (e.g., `ChatService`, `MessageService`) directly referenced third-party Baileys socket classes (`WASocket`, `BaileysMessage`) and IPC wire-format types (`ChatListItem`). This coupled core business logic to the transport library and frontend boundaries.

### Decision
Replace presentation wire formats and transport types in service contracts with domain-level DTOs (e.g., `ChatListEntry` instead of `ChatListItem`) and generic abstractions (e.g., `SocketAccessor` instead of `WASocket`). Map incoming socket payloads at the boundaries (e.g., in event subscribers) and presentation structures in the IPC handlers.

### Consequences
**Enables:**
- Testing core workflows without running or mocking a live socket connection.
- Changing or upgrading the underlying transport SDK without altering business services.

**Constrains:**
- Services must not import `@whiskeysockets/baileys` or IPC handler types.
- Map transport data to domain models before passing it to services.

**Watch for:**
- Interface method changes leaking transport-level parameters.

---

## ADR-5: CPU Work & DB Maintenance Isolation

**Date:** 2026-06-21
**Status:** Accepted

### Context
Leaf services like `EmbeddingService` mixed core embedding generation with heavy CPU thread orchestration (spawning workers) and low-level database maintenance/synchronization (`syncVectors`). This violated the Single Responsibility Principle (SRP) by combining business rules with thread lifecycles and vector table updates.

### Decision
Extract background thread operations to a dedicated `EmbeddingWorkerManager` and database vector table maintenance to `VectorSyncService` (implementing `IVectorSyncService`). Cleanly segregate `IEmbeddingService` into its own interface file.

### Consequences
**Enables:**
- Scaling, testing, and modifying database vector synchronization independently from the embedding generator.
- Safer background execution in worker threads without bloat in the main service logic.

**Constrains:**
- `EmbeddingService` must not reference SQLite vector synchronization tables directly.
- Worker thread spawning must reside solely in `EmbeddingWorkerManager`.

**Watch for:**
- Spawning worker threads directly inside business services bypassing the manager.

---

## ADR-6: Interface-Driven Dependency Injection (DI)

**Date:** 2026-06-20 (Updated 2026-06-21)
**Status:** Accepted

### Context
`ServiceContainer` was wired with concrete classes, and global singletons (like `toolRegistry` in `AIToolService`) were exported at the file level. This bypassed the DI container, using the `new` operator directly, which prevented modular testing and led to hard-wired dependencies.

### Decision
Extract interfaces for all service and repository classes. Define the `ServiceContainer` type registry to map keys strictly to interface abstractions. Inject dependencies through constructors and register all shared services (including `IToolRegistry`) inside the container.

### Consequences
**Enables:**
- Full mockability of the entire system container for integration tests.
- Strict SOLID boundary enforcement across all feature modules.

**Constrains:**
- Classes must never call `new ConcreteClass()` in their bodies; they must receive interfaces via constructors.
- The container must bootstrapped map keys to abstractions, not details.
- Avoid file-level singleton instantiation.

**Watch for:**
- New services bypassing constructor injection.

---

## ADR-7: AI Provider Capabilities & Prompt Strategy Segregation

**Date:** 2026-06-21
**Status:** Accepted

### Context
The `AIProvider` interface was a monolith requiring both streaming and full-response generation, forcing single-mode providers (like streaming-only local LLMs) to write stub methods. In addition, prompt generation logic in `SystemPromptBuilder` was coupled to specific models and used closed ternary switches.

### Decision
Segregate the provider contract into `IStreamingProvider` and `IFullResponseProvider` interfaces. Decompose `SystemPromptBuilder` to call static content (`SystemPromptContent`), formatting helpers (`ToolDefinitionFormatter`), and strategy-based protocol implementations (`IProtocolStrategy` for Standard/React).

### Consequences
**Enables:**
- Supporting single-mode AI providers without stubs and adding new prompt strategies (e.g., JSON mode) without editing the builder class.
- Dynamic capability checking in the AI coordinator layer.

**Constrains:**
- Prompt strategies must implement `IProtocolStrategy` and be resolved through the DI container.

**Watch for:**
- Providers stubbing non-supported methods instead of declaring support for a single interface.
- Inline prompt text overrides in `SystemPromptBuilder`.
