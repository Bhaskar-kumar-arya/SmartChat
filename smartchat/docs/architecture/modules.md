# Module Boundary Map — SmartChat

This document maps the architectural boundaries, public interfaces, internal modules, and dependency relationships for every folder under `src/` to prevent accidental coupling and preserve the layered architecture.

---

# Section 1: Main Process Feature Domains (`src/main/services/`)

## `services/contacts/`

**Purpose:** Coordinates user identity reconciliation, name resolution, LID-PN mappings, profile synchronization, and contact caching.

**Public exports (`index.ts`):**
- *None formalized* (The barrel file `index.ts` exists but is empty; exports are not yet formalized. Sibling modules import interfaces directly).

**Internal only:**
- `ContactService.ts` — concrete contact coordinator.
- `ContactNameResolver.ts` — internal logic for display names mapping.
- `LidPnLinker.ts` — matches and links JID types (LIDs and phone numbers).
- `ContactCache.ts` — handles in-memory contact lists.
- `IdentityReconciliationService.ts` — identity lifecycle coordinator.
- `ProfileSyncService.ts` — profile updater.
- `JidStrategies.ts` — parsing strategies for JID structures.

**Consumes from other modules:**
- None (independent domain).

**Consumed by:**
- `services/chats/` — uses `IContactService`
- `services/messages/` — uses `IContactService`, `IIdentityRepository`
- `services/search/` — uses `IContactService`, `IIdentityRepository`
- `services/ai/` — uses `IContactService`
- `services/whatsapp/` — uses `IContactService`

---

## `services/chats/`

**Purpose:** Manages group chat memberships, community metadata, chat list aggregation, and group participant status.

**Public exports (`index.ts`):**
- *None formalized* (The barrel file `index.ts` exists but is empty; exports are not yet formalized. Sibling modules import interfaces directly).

**Internal only:**
- `ChatService.ts` — concrete chat service coordinator.
- `GroupMembershipService.ts` — manages group actions.
- `ChatListEnricher.ts` — appends previews and unread counts for chat list views.
- `GroupHydrationService.ts` — syncs group states.
- `CommunitySyncHandler.ts`, `ChatSyncHandler.ts`, `MembershipSyncHandler.ts` (in `sync/` subfolder) — sync helpers.

**Consumes from other modules:**
- `services/contacts/` — consumes `IContactService`.
- `services/messages/` — consumes formatters via `MessageFormatterRegistry`.

**Consumed by:**
- `services/whatsapp/` — triggers chat updates.
- `services/messages/` — retrieves chat details.
- `services/search/` — queries chat categories.

---

## `services/messages/`

**Purpose:** Controls message persistence, query parsing, enrichment, reaction tracking, receipt processing, sticker management, and formatters.

**Public exports (`index.ts`):**
- *None formalized* (The barrel file `index.ts` exists but is empty; exports are not yet formalized. Sibling modules import interfaces directly).

**Internal only:**
- `MessageService.ts` — concrete implementation of parsing, query, and writing.
- `MessageParser.ts` — extracts content types and media previews.
- `MessageEnricher.ts` — resolves sender names and links.
- `MessageIdentityResolver.ts` — matches message senders.
- `processors/` (subfolder with its own barrel `index.ts`) — message processors (Standard, Secret, Protocol, Reaction).
- `formatters/` (subfolder with its own barrel `index.ts`) — strategy registry for formatting specific message types.
- `MediaService.ts` — handles media attachment downloads.

**Consumes from other modules:**
- `services/contacts/` — consumes `IContactService`, `IIdentityRepository`, `IIdentityReconciliationService`.
- `services/search/` — consumes `IEmbeddingService`.
- `services/whatsapp/` — consumes `ISecretMessageService` for key exchanges.

**Consumed by:**
- `services/search/` — index builder reads histories.
- `services/whatsapp/` — maps incoming packet events.
- `services/notification/` — gets formatted previews.

---

## `services/search/`

**Purpose:** Coordinates full-text search indexing, vector similarity matches, and background thread embeddings.

**Public exports (`index.ts`):**
- *None formalized* (The barrel file `index.ts` exists but is empty; exports are not yet formalized. Sibling modules import interfaces directly).

**Internal only:**
- `SearchService.ts` — coordinates keyword and similarity searches.
- `EmbeddingService.ts` — queues messages for vector calculation.
- `EmbeddingWorkerManager.ts` — spawns and controls Node `worker_threads` instances.

**Consumes from other modules:**
- `services/contacts/` — consumes `IContactService`, `IIdentityRepository`.
- `services/messages/` — consumes `IMessageQueryRepository`, `IMessageVectorRepository`.

**Consumed by:**
- `services/messages/` — indexes new messages.

---

## `services/ai/`

**Purpose:** Manages provider integration, local model registry keys, and tool definition formatting.

**Public exports (`index.ts`):**
- *None formalized* (The barrel file `index.ts` exists but is empty; exports are not yet formalized. Sibling modules import interfaces directly).

**Internal only:**
- `AIService.ts` — concrete query service.
- `AIChatSessionService.ts` — CRUD operations for AI threads.
- `AIChatExportService.ts` — compiles text summaries of chats.
- `AIKeyService.ts` — manages encrypted key storage.
- `FSKeyStorage.ts` — reads local key credentials.
- `providers/` (subfolder) — AI API clients (Gemini, LM Studio, Groq, Mistral, OpenAI).

**Consumes from other modules:**
- `services/contacts/` — consumes `IContactService`.

**Consumed by:**
- `ipc/` — handles direct prompt requests.

---

## `services/whatsapp/`

**Purpose:** Low-level adapter wiring for Baileys connections, history syncing, socket states, and secret messages.

**Public exports (`index.ts`):**
- `IWAEventBus` — WhatsApp event bus interface.
- `types` — WhatsApp-specific types.

**Internal only:**
- `HistorySyncManager.ts` — batches chat, participant, and message updates.
- `WAEventWiringService.ts` — routes incoming Baileys listeners.
- `ReceiptService.ts` — updates receipt tables.
- `SecretMessageService.ts` — handles end-to-end secret state strategies.
- `subscribers/` (subfolder with its own barrel `index.ts`) — registers listeners on the event bus.

**Consumes from other modules:**
- `services/contacts/` — consumes `IContactService`.
- `services/chats/` — updates group participant models.
- `services/messages/` — persists incoming messages.

**Consumed by:**
- `main/index.ts` — socket startup.

---

# Section 2: Other Services (`src/main/services/`)

## `services/audio/`

**Purpose:** Transcodes audio files (e.g. converting WhatsApp voice notes/ogg to mp3/wav).

**Public exports (`index.ts`):**
- *None* (The barrel file `index.ts` is missing, exports are not yet formalized. Sibling modules import concrete implementations directly. This is a smell).

**Internal only:**
- `AudioTranscoderService.ts` — concrete transcoder service.

**Consumes from other modules:**
- None.

**Consumed by:**
- `ipcHandlers.ts` — transcodes audio files.

---

## `services/auth/`

**Purpose:** Manages user authentication state and credential validation.

**Public exports (`index.ts`):**
- *None* (The barrel file `index.ts` is missing, exports are not yet formalized. Sibling modules import interfaces directly).

**Internal only:**
- `AuthSettingsService.ts` — concrete service.
- `AuthStateRepository.ts` — concrete data repository.
- `IAuthSettingsService.ts`, `IAuthStateRepository.ts` — interfaces.

**Consumes from other modules:**
- None.

**Consumed by:**
- `ServiceContainer.ts` — wired into container.
- `ipcHandlers.ts` — authenticates user credentials.

---

## `services/notification/`

**Purpose:** Creates system tray instances and triggers Electron native desktop notifications.

**Public exports (`index.ts`):**
- *None* (The barrel file `index.ts` is missing, exports are not yet formalized. Sibling modules import interfaces directly).

**Internal only:**
- `NotificationService.ts` — concrete service.
- `ElectronNotificationProvider.ts` — triggers system desktop alerts.
- `TrayService.ts` — controls tray lifecycle.
- `INotificationService.ts`, `INotificationProvider.ts` — interfaces.

**Consumes from other modules:**
- None.

**Consumed by:**
- `ServiceContainer.ts` — wired into container.
- `ipcHandlers.ts`, `index.ts` — tray initialization.

---

## `services/storage/`

**Purpose:** Wraps local filesystem operations for download caching and attachment loading.

**Public exports (`index.ts`):**
- *None formalized* (The barrel file `index.ts` exists but is empty; exports are not yet formalized. Sibling modules import concrete implementations directly. This is a smell).

**Internal only:**
- `LocalFileStorage.ts` — concrete helper.

**Consumes from other modules:**
- None.

**Consumed by:**
- `services/messages/` — consumes local storage manager to clean files.

---

## `services/sync/`

**Purpose:** Orchestrates incoming historical data synchronization chunks for chats, messages, and contacts.

**Public exports (`index.ts`):**
- *None formalized* (The barrel file `index.ts` exists but is empty; exports are not yet formalized. Sibling modules import concrete implementations directly. This is a smell).

**Internal only:**
- `SyncRepository.ts` — concrete persistence helper.
- `SyncChatsHandler.ts` — processes chats.
- `SyncContactsHandler.ts` — processes contacts.
- `SyncMessagesHandler.ts` — processes messages.
- `ISyncRepository.ts` — interface.

**Consumes from other modules:**
- `services/contacts/` — consumes `IContactService`.
- `services/chats/` — consumes `IChatRepository`.
- `services/messages/` — consumes `IMessageWriterService`.

**Consumed by:**
- `historySync.ts` — invoked when a history sync chunk is received from the WhatsApp socket.

---

# Section 3: Supporting Main Process Modules (`src/main/`)

## `main/domain/`

**Purpose:** Houses the application-wide core types and interface definitions.

**Public exports (`index.ts`):**
- *None* (The barrel file `index.ts` is missing, exports are not yet formalized. Sibling modules import files directly).

**Internal only:**
- `types.ts` — domain core types.
- `whatsapp.types.ts` — WhatsApp infra types.

**Consumes from other modules:**
- None.

**Consumed by:**
- Wide sections of `services/` and `ipc/`.

---

## `main/ipc/`

**Purpose:** Defines standard IPC channel payload types.

**Public exports (`index.ts`):**
- *None* (The barrel file `index.ts` is missing, exports are not yet formalized. Sibling modules import files directly).

**Internal only:**
- `types.ts` — IPC transport interfaces.

**Consumes from other modules:**
- None.

**Consumed by:**
- `renderer/` and `main/` for type-safe IPC communication.

---

## `main/workers/`

**Purpose:** Runs CPU-intensive computations in background Node threads.

**Public exports (`index.ts`):**
- *None* (The barrel file `index.ts` is missing, exports are not yet formalized. Sibling modules import files directly).

**Internal only:**
- `embedding.worker.ts` — background vectorizer.

**Consumes from other modules:**
- None.

**Consumed by:**
- `services/search/` (`EmbeddingWorkerManager`).

---

## `main/utils/`

**Purpose:** Common parsing and utility helpers for JIDs, communities, and message metadata.

**Public exports (`index.ts`):**
- *None* (The barrel file `index.ts` is missing, exports are not yet formalized. Sibling modules import files directly).

**Internal only:**
- `jidUtils.ts` — JID normalizers.
- `messageUtils.ts` — Baileys message extractors.
- `communityUtils.ts` — Community metadata parser.

**Consumes from other modules:**
- None.

**Consumed by:**
- `services/chats/`, `services/contacts/`, `services/messages/`, `services/whatsapp/`

---

## `main/tools/`

**Purpose:** Concrete implementation of tools for the AI agent loop (sending messages, database queries).

**Public exports (`index.ts`):**
- *None* (The barrel file `index.ts` is missing, exports are not yet formalized. Sibling modules import files directly).

**Internal only:**
- `ExecuteScriptTool.ts`
- `MessageActionTool.ts`
- `QueryDatabaseTool.ts`
- `ReadMessagesTool.ts`
- `SendMessageTool.ts`

**Consumes from other modules:**
- `services/ai/`
- `services/messages/`
- `services/chats/`

**Consumed by:**
- `services/ai/` (`AIToolInitializer` registers these tools onto the AI sessions).

---

# Section 4: Electron Preload Module (`src/preload/`)

## `preload/`

**Purpose:** Exposes safe APIs from the main process to the renderer process via `contextBridge`.

**Public exports (`index.ts` / `index.d.ts`):**
- Exposes window global Electron APIs under `window.api` and `window.context`.

**Internal only:**
- None.

**Consumes from other modules:**
- `ipc/` types.

**Consumed by:**
- `renderer/` (loads it via window context).

---

# Section 5: React Frontend Application (`src/renderer/`)

## `renderer/src/components/`

**Purpose:** UI components built with React (chat layout, messages, inputs, search panels).

**Public exports (`index.ts`):**
- *None formalized* (The barrel file `index.ts` exists but is empty; exports are not yet formalized).
- Subfolder `renderer/src/components/chat/index.ts` exists and formalizes:
  - `ChatLayout`, `ChatList`, `MessageView`, `MessageInput`.

**Internal only:**
- UI components (e.g. `WaveformPlayer`, `EmojiStickerGifPicker`).

**Consumes from other modules:**
- `renderer/src/context/`, `renderer/src/hooks/`, `renderer/src/services/`, `renderer/src/utils/`

**Consumed by:**
- `App.tsx`

---

## `renderer/src/context/`

**Purpose:** React Context providers for global states.

**Public exports (`index.ts`):**
- *None* (The barrel file `index.ts` is missing, exports are not yet formalized).

**Internal only:**
- `APIContext.tsx`

**Consumes from other modules:**
- None.

**Consumed by:**
- UI components.

---

## `renderer/src/hooks/`

**Purpose:** Custom React hooks for local state and event orchestration (audio recording, drags, mentions, search).

**Public exports (`index.ts`):**
- *None* (The barrel file `index.ts` is missing, exports are not yet formalized).

**Internal only:**
- various hooks (e.g., `useMentions`, `usePresence`, `useDragAndDrop`).

**Consumes from other modules:**
- `renderer/src/services/`

**Consumed by:**
- UI components.

---

## `renderer/src/services/`

**Purpose:** Service clients wrapping the IPC bridges for calling backend services.

**Public exports (`index.ts`):**
- *None* (The barrel file `index.ts` is missing, exports are not yet formalized).

**Internal only:**
- `api.service.ts`

**Consumes from other modules:**
- None.

**Consumed by:**
- UI hooks and components.

---

## `renderer/src/utils/`

**Purpose:** Frontend utility helpers (formatting, emoji keywords, editor parsing).

**Public exports (`index.ts`):**
- *None* (The barrel file `index.ts` is missing, exports are not yet formalized).

**Internal only:**
- various utility files (e.g., `emojiUtils.ts`, `editorUtils.ts`).

**Consumes from other modules:**
- None.

**Consumed by:**
- UI components and hooks.

---

## `renderer/src/assets/`

**Purpose:** Houses static assets (images, icons).

**Public exports (`index.ts`):**
- *None* (The barrel file `index.ts` is missing).

**Consumed by:**
- UI components.

---

## `renderer/src/styles/`

**Purpose:** Houses global and component CSS files.

**Public exports (`index.ts`):**
- *None* (The barrel file `index.ts` is missing).

**Consumed by:**
- Frontend entry points (`main.tsx`).
