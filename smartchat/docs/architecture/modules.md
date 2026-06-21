# Module Boundary Map — SmartChat

This document maps the architectural boundaries, public interfaces, internal modules, and dependency relationships for every folder under `src/` to prevent accidental coupling and preserve the layered architecture.

---

# Section 1: Main Process Feature Domains (`src/main/services/`)

## `services/contacts/`
- **Purpose:** Coordinates user identity reconciliation, name resolution, LID-PN mapping, and caching.
- **Public exports (`index.ts`):** None (unformalized empty barrel).
- **Internal only:** `ContactService.ts`, `ContactNameResolver.ts`, `LidPnLinker.ts`, `ContactCache.ts`, `IdentityReconciliationService.ts`, `ProfileSyncService.ts`, `JidStrategies.ts`, interfaces (`IContact*Service`, `ISocketUserContext`, `IMediaSocket`), and repository implementations/interfaces (`Identity`, `Alias`, `LidMap`).
- **Consumes:** `main/utils/`, `main/domain/`
- **Consumed by:** `services/chats/`, `services/messages/`, `services/search/`, `services/ai/`, `services/whatsapp/`

---

## `services/chats/`
- **Purpose:** Manages group chat memberships, community metadata, chat list aggregation, and group participant status.
- **Public exports (`index.ts`):** None (unformalized empty barrel).
- **Internal only:** `ChatService.ts`, `GroupMembershipService.ts`, `ChatListEnricher.ts`, `GroupHydrationService.ts`, `sync/` (`CommunitySyncHandler.ts`, `ChatSyncHandler.ts`, `MembershipSyncHandler.ts`), interfaces (`IChatQueryService`, `IChatMutationService`, `IGroupParticipantResolver`, `IGroupMetadataFetcher`), and repository implementations/interfaces (`Chat`, `Community`, `ChatMember`).
- **Consumes:** `services/contacts/`, `services/messages/`
- **Consumed by:** `services/whatsapp/`, `services/messages/`, `services/search/`

---

## `services/messages/`
- **Purpose:** Controls message persistence, query parsing, enrichment, reaction tracking, receipt processing, sticker management, and formatters.
- **Public exports (`index.ts`):** None (unformalized empty barrel).
- **Internal only:** `MessageService.ts`, `MessageParser.ts`, `MessageEnricher.ts`, `MessageIdentityResolver.ts`, `processors/` (`IMessageProcessorStrategy` and concrete processors), `formatters/` (`MessageFormatter`, `MessageFormatterRegistry` and concrete formatters), `MediaService.ts`, `MessageActionService.ts`, `FavoriteStickerService.ts`, repository implementations/interfaces (`Message`, `MessageQuery`, `MessageVector`, `Receipt`, `Reaction`), and service interfaces (`IMessage*Service`).
- **Consumes:** `services/contacts/`, `services/search/`, `services/whatsapp/`
- **Consumed by:** `services/search/`, `services/whatsapp/`, `services/notification/`

---

## `services/search/`
- **Purpose:** Coordinates full-text search indexing, vector similarity matches, and background thread embeddings.
- **Public exports (`index.ts`):** None (unformalized empty barrel).
- **Internal only:** `SearchService.ts`, `EmbeddingService.ts`, `VectorSyncService.ts`, `EmbeddingWorkerManager.ts`, and interfaces (`ISearchService`, `IEmbeddingComputer`, `IMessageIndexer`, `IEmbeddingModelConfig`, `IEmbeddingOperationalControl`, `IVectorSyncService`, `IEmbeddingWorkerManager`).
- **Consumes:** `services/contacts/`, `services/messages/`
- **Consumed by:** `services/messages/`

---

## `services/ai/`
- **Purpose:** Manages provider integration, local model registry keys, and tool definition formatting.
- **Public exports (`index.ts`):** None (unformalized empty barrel).
- **Internal only:** `AIService.ts`, `AIChatSessionService.ts`, `AIChatExportService.ts`, `AIKeyService.ts`, `FSKeyStorage.ts`, `AIToolService.ts` (`ToolRegistry`), `SystemPromptBuilder.ts`, `prompts/` (definitions and strategies), and `providers/` (interfaces and client adapters).
- **Consumes:** `services/contacts/`
- **Consumed by:** `ipc/`

---

## `services/whatsapp/`
- **Purpose:** Low-level adapter wiring for Baileys connections, history syncing, socket states, and secret messages.
- **Public exports (`index.ts`):** `IWAEventBus`, `types` (WhatsApp-specific types barrel).
- **Internal only:** `HistorySyncManager.ts`, `WAEventWiringService.ts`, `ReceiptService.ts`, `SecretMessageService.ts`, `WASocketFactory.ts`, `WACatchUpManager.ts`, and `subscribers/` (event subscriber factory).
- **Consumes:** `services/contacts/`, `services/chats/`, `services/messages/`
- **Consumed by:** `main/index.ts`

---

# Section 2: Other Services (`src/main/services/`)

## `services/audio/`
- **Purpose:** Transcodes audio files (converting voice notes/ogg to mp3/wav).
- **Public exports (`index.ts`):** None (barrel missing - smell).
- **Internal only:** `AudioTranscoderService.ts`.
- **Consumes:** None.
- **Consumed by:** `ipcHandlers.ts`

---

## `services/auth/`
- **Purpose:** Manages user authentication state and credential validation.
- **Public exports (`index.ts`):** None (barrel missing - smell).
- **Internal only:** `AuthSettingsService.ts`, `AuthStateRepository.ts`, `IAuthSettingsService.ts`, `IAuthStateRepository.ts`.
- **Consumes:** None.
- **Consumed by:** `ServiceContainer.ts`, `ipcHandlers.ts`

---

## `services/notification/`
- **Purpose:** Creates system tray instances and triggers native desktop notifications.
- **Public exports (`index.ts`):** None (barrel missing - smell).
- **Internal only:** `NotificationService.ts`, `ElectronNotificationProvider.ts`, `TrayService.ts`, `INotificationService.ts`, `INotificationProvider.ts`.
- **Consumes:** None.
- **Consumed by:** `ServiceContainer.ts`, `ipcHandlers.ts`, `index.ts`

---

## `services/storage/`
- **Purpose:** Wraps local filesystem operations for download caching and attachment loading.
- **Public exports (`index.ts`):** None (unformalized empty barrel).
- **Internal only:** `LocalFileStorage.ts`.
- **Consumes:** None.
- **Consumed by:** `services/messages/`

---

## `services/sync/`
- **Purpose:** Orchestrates incoming historical data synchronization chunks.
- **Public exports (`index.ts`):** None (unformalized empty barrel).
- **Internal only:** `SyncRepository.ts`, `SyncChatsHandler.ts`, `SyncContactsHandler.ts`, `SyncMessagesHandler.ts`, `ISyncRepository.ts`.
- **Consumes:** `services/contacts/`, `services/chats/`, `services/messages/`
- **Consumed by:** `historySync.ts`

---

# Section 3: Supporting Main Process Modules (`src/main/`)

## `main/domain/`
- **Purpose:** Houses the application-wide core types and interface definitions.
- **Public exports (`index.ts` is missing/unused, but `types.ts` is the main barrel):** `types.ts`, `whatsapp.types.ts`, `entities.ts`, `db.types.ts`, `filters.ts`, `projections.ts`, `chatList.types.ts`.
- **Consumes:** None.
- **Consumed by:** Wide sections of `services/` and `ipc/`.

---

## `main/ipc/`
- **Purpose:** Defines standard IPC channel payload types.
- **Public exports (`index.ts` is missing):** `types.ts`, `message.types.ts`, `chat.types.ts`, `reaction.types.ts`.
- **Consumes:** None.
- **Consumed by:** `renderer/` and `main/` for type-safe IPC communication.

---

## `main/workers/`
- **Purpose:** Runs CPU-intensive computations in background Node threads.
- **Public exports (`index.ts` is missing):** None.
- **Internal only:** `embedding.worker.ts`.
- **Consumes:** None.
- **Consumed by:** `services/search/` (`EmbeddingWorkerManager`).

---

## `main/utils/`
- **Purpose:** Common parsing and utility helpers for JIDs, communities, and message metadata.
- **Public exports (`index.ts` is missing):** `jidUtils.ts`, `messageUtils.ts`, `communityUtils.ts`, `contactUtils.ts`.
- **Consumes:** None.
- **Consumed by:** `services/chats/`, `services/contacts/`, `services/messages/`, `services/whatsapp/`

---

## `main/tools/`
- **Purpose:** Concrete implementation of tools for the AI agent loop.
- **Public exports (`index.ts` is missing):** None.
- **Internal only:** `ExecuteScriptTool.ts`, `MessageActionTool.ts`, `QueryDatabaseTool.ts`, `ReadMessagesTool.ts`, `SendMessageTool.ts`.
- **Consumes:** `services/ai/`, `services/messages/`, `services/chats/`
- **Consumed by:** `services/ai/` (`AIToolInitializer`)

---

# Section 4: Electron Preload Module (`src/preload/`)

## `preload/`
- **Purpose:** Exposes safe APIs from the main process to the renderer process via `contextBridge`.
- **Public exports (`index.ts` / `index.d.ts`):** Exposes window global Electron APIs under `window.api` and `window.context`.
- **Consumes:** `ipc/` types.
- **Consumed by:** `renderer/` (loads it via window context).

---

# Section 5: React Frontend Application (`src/renderer/`)

## `renderer/src/components/`
- **Purpose:** UI components built with React (chat layout, messages, inputs, search panels).
- **Public exports (`index.ts`):** None (empty barrel). Subfolders `chat/index.ts` and `ai/index.ts` formalize components.
- **Internal only:** UI components (e.g. `WaveformPlayer`, `EmojiStickerGifPicker`).
- **Consumes:** `renderer/src/context/`, `renderer/src/hooks/`, `renderer/src/services/`, `renderer/src/utils/`
- **Consumed by:** `App.tsx`

---

## `renderer/src/types/`
- **Purpose:** Layer-segregated UI, AI, media protocol, and React prop type definitions.
- **Public exports (`index.ts` is missing/unused):** `chat.types.ts`, `message.types.ts`, `search.types.ts`, `presence.types.ts`, `group.types.ts`, `notification.types.ts`, `ai/model.types.ts`, `ai/session.types.ts`, `ai/chat.types.ts`, `ai/tool.types.ts`, `mediaTypes.ts`, `componentProps.ts`.
- **Consumes:** None.
- **Consumed by:** Components, hooks, services, and context.

---

## `renderer/src/context/`
- **Purpose:** React Context providers for global states.
- **Public exports (`index.ts`):** None (barrel missing).
- **Internal only:** `APIContext.tsx`.
- **Consumes:** `renderer/src/services/` (`IAPIService`).
- **Consumed by:** UI components.

---

## `renderer/src/hooks/`
- **Purpose:** Custom React hooks for local state and event orchestration.
- **Public exports (`index.ts`):** None (barrel missing).
- **Internal only:** various hooks (e.g., `useMentions`, `usePresence`, `useDragAndDrop`).
- **Consumes:** `renderer/src/services/`
- **Consumed by:** UI components.

---

## `renderer/src/services/`
- **Purpose:** Service clients wrapping the IPC bridges for calling backend services.
- **Public exports (`index.ts`):** None (barrel missing).
- **Internal only:** `api.service.ts`, `IAPIService.ts`.
- **Consumes:** None.
- **Consumed by:** UI hooks, components, and `APIContext`.

---

## `renderer/src/utils/`
- **Purpose:** Frontend utility helpers (formatting, emoji keywords, editor parsing).
- **Public exports (`index.ts`):** None (barrel missing).
- **Internal only:** various utility files (e.g., `emojiUtils.ts`, `editorUtils.ts`).
- **Consumes:** None.
- **Consumed by:** UI components and hooks.

---

## `renderer/src/assets/`
- **Purpose:** Houses static assets (images, icons).
- **Public exports (`index.ts`):** None (barrel missing).
- **Consumed by:** UI components.

---

## `renderer/src/styles/`
- **Purpose:** Houses global and component CSS files.
- **Public exports (`index.ts`):** None (barrel missing).
- **Consumed by:** Frontend entry points (`main.tsx`).
