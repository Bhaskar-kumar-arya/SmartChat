# Architecture Decision Records (ADR) — SmartChat

This document records the major architectural decisions made during the SmartChat codebase refactoring pipeline, including context, decisions, and consequences.

---

## ADR-1: Shared Types & Utilities Segregation

**Date:** 2026-06-20
**Status:** Accepted

### Context
A monolithic `types.ts` file was imported by all layers, coupling utility logic, domain definitions, and third-party Baileys WhatsApp client library types (`WASocket`, `proto`, etc.) together. Importers of general utility helpers (like `cleanJid`) were transitively coupled to heavy socket libraries, making testing difficult and leaking implementation details.

### Decision
Split `types.ts` into layer-specific files: separate internal Baileys types (`whatsapp.types.ts`) from clean domain definitions (`types.ts`). Deconstruct `utils.ts` into cohesive utility modules: `jidUtils.ts` (formatting/identifiers), `messageUtils.ts` (message structures), and `communityUtils.ts` (community-specific logic).

### Consequences
**Enables:**
- Layer isolation between third-party socket protocols and internal utilities.
- Easier unit testing of utility helpers without loading Baileys models.
- Independent utility changes without recompiling or affecting the socket manager.

**Constrains:**
- Domain layer code must only import from clean domain type files.
- Utilities must not import `@whiskeysockets/baileys` directly.

**Watch for:**
- Static dependency leaks when writing helpers that extract raw nested packet payload fields.

---

## ADR-2: Repository Interface Segregation & ORM Isolation

**Date:** 2026-06-20
**Status:** Accepted

### Context
Repository interfaces (such as `IChatRepository`, `IMessageRepository`, and `IReactionRepository`) mixed read query operations with write command mutations. In addition, these interfaces directly referenced and returned Prisma ORM models (e.g. `Chat`, `Message`), leaking the database schema into the domain and service layers.

### Decision
Split repository interfaces into read and write interfaces (e.g., `IChatReadRepository` and `IChatWriteRepository`). Map ORM model entities to clean domain DTOs/interfaces inside the concrete repository implementations before returning them to services.

### Consequences
**Enables:**
- Compliance with the Interface Segregation Principle (ISP) — read-only services do not depend on write methods.
- Complete decoupling of services from database schema modifications.
- Simple mock class creation for unit testing service layers.

**Constrains:**
- Services must NEVER import Prisma models directly.
- Concrete repository classes must map all ORM structures to domain types before exporting.

**Watch for:**
- Monolithic database queries that fetch complex relationships; they should be broken down or mapped through query services.

---

## ADR-3: Event Bus Abstraction

**Date:** 2026-06-20
**Status:** Accepted

### Context
Event-driven services directly imported and depended on the concrete `WAEventBus` implementation. This tightly bound connection handlers, history sync, and chat services to one event implementation, preventing modular testing.

### Decision
Extract the `IWAEventBus` interface representing the pub/sub event handler contract, and instantiate the event bus using `WAEventBusFactory`. Update all subscribers to depend strictly on the interface.

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

## ADR-4: Leaf Services Isolation & Generalization

**Date:** 2026-06-20
**Status:** Accepted

### Context
Leaf-level services (services with zero service-level dependencies) like `EmbeddingService` handled raw thread management, configuration, and filesystem paths in addition to business logic. Similarly, `IAIKeyService` used a hardcoded union list of supported model providers.

### Decision
Extract `EmbeddingWorkerManager` to handle background thread operations and configuration. Generalize the provider key storage contract to use open-ended indexing (`Record<string, string>`) instead of a fixed union.

### Consequences
**Enables:**
- Supporting new AI model providers without changing interface definitions.
- Running embedding vector operations safely in background worker threads without bloat in the main service logic.

**Constrains:**
- Thread lifecycles must live inside the worker manager, never in the embedding orchestrator.
- Configuration and userData paths must be injected rather than hardcoded.

**Watch for:**
- Spawning worker threads directly inside business services bypassing `EmbeddingWorkerManager`.
- Hardcoding specific client provider config maps inside `IAIKeyService`.

---

## ADR-5: Mid-Level Service Strategy Injection & Decoupling

**Date:** 2026-06-20
**Status:** Accepted

### Context
`ContactService` hardcoded JID strategy instantiations (`PnJidStrategy`, `LidJidStrategy`, etc.) directly in its initialization code, violating OCP. It also combined name resolution, synchronization workflows, and cache management.

### Decision
Inject JID strategies as an array of `IJidStrategy` interfaces via constructor injection. Extract cache management to a separate `ContactCache` class. Segregate `IChatService` into query, mutation, and participant resolution interfaces.

### Consequences
**Enables:**
- Extending the system with new JID strategy types without modifying existing service code.
- Decoupled caching, easing data-wipe and lifecycle operations.

**Constrains:**
- All JID strategies must implement the common `IJidStrategy` contract.
- Caching logic must reside in `ContactCache`, not the service orchestrator.

**Watch for:**
- Re-introducing new JID parsing checks inline rather than adding a strategy.
- Adding database sync operations inside caching helper classes.

---

## ADR-6: Transport Decoupling in Message Pipeline

**Date:** 2026-06-20
**Status:** Accepted

### Context
The message query and writer services directly referenced Baileys WhatsApp client socket types (`WASocket`, `BaileysMessage`) in their method signatures. This coupled core message logic directly to the transport/socket library, violating DIP.

### Decision
Extract clean domain models for message synchronization and parsing. Segregate `IMessageQueryService` and `IMessageWriterService` into Parser, Processing, Query, and Writer interfaces that accept library-agnostic domain data shapes.

### Consequences
**Enables:**
- Testing the core message ingestion flow without running or mocking a live socket connection.
- The ability to switch or upgrade the underlying WhatsApp connection library (e.g. swap Baileys for whatsmeow or an API gateway) with zero edits to the message service.

**Constrains:**
- Socket events must be mapped to domain interfaces at the boundary (e.g., in event subscribers/wiring), before calling the message service.

**Watch for:**
- Method parameter changes in core message services that leak Baileys socket structures.
- Direct imports of `@whiskeysockets/baileys` inside domain message files.

---

## ADR-7: Interface-Driven Dependency Injection (DI)

**Date:** 2026-06-20
**Status:** Accepted

### Context
`ServiceContainer` was wired with concrete classes, and its type definition registry mapped keys directly to these implementations. Changing a service required modifying the container type, and cross-service dependencies were hard-wired.

### Decision
Extract interfaces for all service and repository classes. Define the `ServiceContainer` type registry to map keys strictly to interface abstractions. Inject dependencies through constructors.

### Consequences
**Enables:**
- Full mockability of the entire system container for integration tests.
- Strict SOLID boundary enforcement across all feature modules.

**Constrains:**
- Classes must never call `new ConcreteClass()` in their bodies; they must receive interfaces via constructors.
- The container must bootstrapper map keys to abstractions, not details.

**Watch for:**
- New services or repositories added to the container typing concrete classes instead of abstractions.
- Hardcoded instantiations of dependencies in constructors, bypassing constructor injection.
