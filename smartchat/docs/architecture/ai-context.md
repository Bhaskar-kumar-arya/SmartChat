# SmartChat — AI Context File

## Stack
Electron + React + TS | Decoupled, Layered SOLID | SQLite (Prisma ORM), better-sqlite3, sqlite-vec, Baileys SDK

## Key Patterns
| Pattern | Where | Rule |
|---|---|---|
| Repository | `services/<domain>/<Name>Repository.ts` | All DB queries/ORM statements live here. Return DTOs, never Prisma entities. |
| Strategy | `services/messages/formatters/` | Formatting variants must implement `supports(type)` and `format()`. |
| Strategy | `services/ai/prompts/` | Prompt protocol strategies must implement `IProtocolStrategy`. |
| Subscriber | `services/whatsapp/subscribers/` | Event listeners must implement `IWAEventSubscriber`, register, and clean up on dispose. |
| DI Container | `src/main/ServiceContainer.ts` | Wire all dependencies via constructor injection. Map container keys to interfaces. |

## Hard Constraints
- **No Concrete Imports:** Services must only import interfaces (`I[Service].ts`, `I[Repo].ts`) from other domains.
- **No ORM Leaks:** PrismaClient must never be imported outside repositories. Replace open queries with typed `MessageQueryFilter`.
- **No Direct Socket Access:** Services must never import or reference `WASocket` or Baileys event structures. Use `SocketAccessor`.
- **No Global Singletons Bypassing DI:** All services (including `IToolRegistry`) must be wired inside `ServiceContainer.ts`.
- **Clean Process Separation:** Renderer and main process communicate strictly via `IAPIService` contract in Preload.

## Module Map
| Module | Public Interface | Owned Concrete Classes |
|---|---|---|
| `contacts` | `IContactService`, `IIdentityReconciliationService` | `ContactService`, `LidPnLinker`, `ContactNameResolver`, `ContactCache` |
| `chats` | `IChatService`, `IGroupMembershipService`, `IGroupHydrationService` | `ChatService`, `GroupMembershipService`, `ChatListEnricher`, `GroupHydration` |
| `messages` | `IMessageWriterService`, `IMessageQueryService`, `IMessageActionService`, `IMediaService` | `MessageService`, `MessageParser`, `MessageEnricher`, `MediaService`, `ActionService` |
| `search` | `ISearchService`, `IEmbeddingService`, `IVectorSyncService` | `SearchService`, `EmbeddingService`, `VectorSyncService`, `EmbeddingWorkerManager` |
| `ai` | `IAIService`, `IAIChatSessionService`, `IAIKeyService`, `IToolRegistry` | `AIService`, `AIChatSessionService`, `AIKeyService`, `ToolRegistry`, `SystemPromptBuilder` |
| `whatsapp` | `IHistorySyncManager`, `IWAEventWiringService`, `ISecretMessageService` | `HistorySyncManager`, `WAEventWiringService`, `SecretMessageService`, `WACatchUpManager` |

## Extension Points
| To add... | Do this |
|---|---|
| Message formatter | Create class implementing `MessageFormatter`, register in `formatters/index.ts`. |
| JID parsing strategy | Create class implementing `IJidStrategy`, add to `strategies` array in `ServiceContainer.ts`. |
| AI Provider adapter | Implement `IStreamingProvider` or `IFullResponseProvider` under `providers/`, wire in `AIService`. |
| Prompt protocol strategy | Implement `IProtocolStrategy` under `prompts/`, wire into `SystemPromptBuilder` in `ServiceContainer`. |
| Database query | Add abstract method to narrower `I[Name]Repository`, implement in concrete repository, map Prisma DTO. |
| AI Tool | Create tool file in `main/tools/`, instantiate/wire in `AIToolInitializer.ts` / `ServiceContainer.ts`. |

## What NOT to do
- Do not reference `typeof api` in renderer React Context type; bind strictly to `IAPIService` interface.
- Do not reference presentation layer types (e.g. `ChatListItem`) in service interfaces; use domain DTOs (`ChatListEntry`).
- Do not use `as any` or `!` type assertions; write explicit type guards or type checking.
- Do not invoke `app.getPath()` or Node FS utilities in services; inject paths at boot.
- Do not import concrete classes across module boundaries; always program to interfaces.
