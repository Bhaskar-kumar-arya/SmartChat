# Backend Unit Testing Roadmap

This document outlines the exact order in which you should write unit tests for the SmartChat backend. 

The order is designed **bottom-up based on dependencies**. By testing the most independent, pure components first (Phase 1), you ensure that when you move on to complex services (Phase 4), you aren't chasing bugs caused by foundational layers. 

## Phase 1: Pure Logic, Utilities & Strategies
**Priority:** Highest | **Dependencies:** None
These classes contain pure business logic, formatting, and string manipulation. They require **zero mocking** (no databases, no external APIs). You just pass in inputs and assert outputs. Tests here are fast to write and execute instantly.

- [x] `PnJidStrategy`
- [x] `LidJidStrategy`
- [x] `GroupJidStrategy`
- [x] `BotJidStrategy`
- [x] `MessageReactionStrategy`
- [x] `ReactProtocolStrategy`
- [x] `StandardProtocolStrategy`
- [x] `MessageParser`
- [x] `MessageProcessors`
  - `SecretMessageProcessor`
  - `ProtocolMessageProcessor`
  - `ReactionMessageProcessor`
  - `StandardMessageProcessor`
- [x] `ContactCache`
- [x] Message Formatters (`createMessageFormatterRegistry`)

## Phase 2: Repositories (Data Access Layer)
**Priority:** High | **Dependencies:** Prisma / SQLite
These components interact directly with the database. You should use your existing `vitest` + SQLite setup (like in `basic.test.ts`) to test these. Focus on complex queries, upserts, and joins; skip testing simple `findUnique` wrappers.

- [x] `IdentityRepository`
- [x] `AliasRepository`
- [x] `LidMapRepository`
- [x] `ChatRepository`
- [x] `CommunityRepository`
- [x] `ChatMemberRepository`
- [x] `MessageRepository`
- [x] `MessageQueryRepository` (Focus on `IRawSqlExecutor` logic)
- [x] `MessageVectorRepository`
- [x] `ReceiptRepository`
- [x] `ReactionRepository`
- [x] `SyncRepository`
- [x] `CallRepository`
- [x] `AuthStateRepository`

## Phase 3: Foundational Domain Services
**Priority:** High | **Dependencies:** Repositories (Phase 2), Strategies (Phase 1)
These are the building blocks of your application. You will inject **mocked repositories** into these services via their constructors.

- [x] `LidPnLinker`
- [x] `ContactNameResolver`
- [x] `ContactService` (Crucial: Many other services depend on this)
- [x] `FavoriteStickerService`
- [x] `SecretMessageService`
- [x] `VectorSyncService`
- [x] `CallService`
- [x] `FSKeyStorage`
- [x] `AIKeyService`
- [x] `DataWipeService`
- [x] `AuthSettingsService`
- [x] `NotificationService`

## Phase 4: Complex Domain Services & Aggregators
**Priority:** Medium | **Dependencies:** Foundation Services (Phase 3), Repositories (Phase 2)
These services coordinate multiple foundational services and repositories to execute complex business workflows. You will need to use mock libraries extensively here to isolate the logic.

- [x] `IdentityReconciliationService`
- [x] `ProfileSyncService`
- [x] `GroupMembershipService`
- [x] `ChatListEnricher`
- [x] `ChatService`
- [x] `ChatActionService`
- [x] `MessageEnricher`
- [x] `MessageIdentityResolver`
- [x] `MessageService` (Highly complex, break this down into multiple test suites)
- [x] `MessageSenderService`
- [x] `MessageActionService`
- [x] `MediaService`
- [x] `SearchService`

## Phase 5: Sync Handlers & Hydration
**Priority:** Medium | **Dependencies:** Repositories & Contact Services
Specific handlers for processing WhatsApp's background sync payloads. 

- [x] `CommunitySyncHandler`
- [x] `ChatSyncHandler`
- [x] `MembershipSyncHandler`
- [x] `GroupHydrationService`

## Phase 6: AI & Tool Services
**Priority:** Medium-Low | **Dependencies:** AI Provider APIs, Strategies
These services handle prompt generation and external API calls. You will need to mock out the actual LLM API calls.

- [x] `SystemPromptBuilder`
- [x] `ToolRegistry`
- [x] `AIService`
- [x] `AIChatSessionService`
- [x] `AIChatExportService`
- [x] `APIConfigProvider`
- [x] `APIServer`

## Phase 7: Event Subscribers, Workers & Lifecycle
**Priority:** Low | **Dependencies:** Event Bus, All Services
These components sit at the boundary of your application. They listen to WhatsApp events and route them to the correct services. You should test that the correct service method is called when a specific event payload is received.

- [x] `ReceiptService`
- [ ] `EmbeddingWorkerManager` & `EmbeddingService` (requires mocking worker threads)
- [x] `WASocketFactory`
- [x] `WACatchUpManager`
- [x] `HistorySyncManager`
- [x] `WAEventWiringService`
- [x] `WAWorkerBridge`
- [x] All `IWAEventSubscriber` implementations (e.g., `FavoriteStickerSubscriber`, `MessageSubscriber`, etc.)
