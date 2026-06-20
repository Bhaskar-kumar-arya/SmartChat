# SmartChat — AI Context File

## Stack
Electron + TypeScript + React | Layered SOLID Architecture | SQLite (Prisma ORM) & SQLite-Vec | Baileys WhatsApp SDK

## Key Patterns
| Pattern | Location | Rule |
|---|---|---|
| Repository | `services/<domain>/<Name>Repository.ts` | All DB queries/ORM statements live here. Return DTOs, never Prisma entities. |
| Strategy | `services/messages/formatters/` | Formatting variants must implement `supports(type)` and `format()`. |
| Subscriber | `services/whatsapp/subscribers/` | Listeners must depend on `IWAEventBus`, register, and clean up on dispose. |
| DI Container | `src/main/ServiceContainer.ts` | Maps keys to interface types, never concrete classes. |

## Hard Constraints
- **No Concrete Imports Across Modules:** Services must import interfaces from sibling domains, never concrete classes.
- **No ORM Leaks:** Prisma client imports and database entities are strictly forbidden outside `*Repository.ts` files.
- **No Direct Socket Access:** Business services must not accept or hold reference to `WASocket` or library-specific packet types.
- **Constructor Injection Only:** Never use `new` to instantiate a dependency inside a service; inject the interface via constructor.

## Module Map
| Module | Public Interface | Owned Concrete Classes |
|---|---|---|
| `contacts` | `IContactService`, `IIdentityReconciliationService` | `ContactService`, `LidPnLinker`, `ContactNameResolver` |
| `chats` | `IChatService`, `IGroupMembershipService`, `IGroupHydrationService` | `ChatService`, `GroupMembershipService`, `ChatListEnricher` |
| `messages` | `IMessageWriterService`, `IMessageQueryService`, `IMessageActionService` | `MessageService`, `MessageParser`, `MessageEnricher`, `MediaService` |
| `search` | `ISearchService`, `IEmbeddingService` | `SearchService`, `EmbeddingService`, `EmbeddingWorkerManager` |
| `ai` | `IAIService`, `IAIChatSessionService`, `IAIKeyService` | `AIService`, `AIChatSessionService`, `AIKeyService` |
| `whatsapp` | `IHistorySyncManager`, `IWAEventWiringService`, `ISecretMessageService` | `HistorySyncManager`, `WAEventWiringService`, `SecretMessageService` |

## Extension Points
| To add... | Do this |
|---|---|
| New message type formatter | Create formatter implementing `MessageFormatter`, register in `formatters/index.ts`. |
| New JID parsing strategy | Create strategy implementing `IJidStrategy`, add to `strategies` array in `ServiceContainer.ts`. |
| New AI Provider adapter | Implement `AIProvider` under `services/ai/providers/`, add to factory registry. |
| New database query | Add abstract method to `I<Name>ReadRepository`, implement in `<Name>Repository`, call in Service. |

## What NOT to do
- Do not add business logic, JSON parsing, or path resolution directly inside `ServiceContainer.ts`.
- Do not use `as any` or non-null assertions (`!.`); use explicit type guards or optional chaining.
- Do not let catch blocks swallow errors silently; always log with `[ContextName]` prefix.
- Do not call `app.getPath()` or node-specific filesystem libraries in services; pass resolved directories at boot.
