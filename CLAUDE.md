# SmartChat agent guide

The app lives in `smartchat/` (Electron + React + Baileys + Prisma/better-sqlite3). Run all npm commands from `smartchat/`.
The refactor plan and state are in `smartchat/refactor/` (`PLAN.md`, `TRACKER.md`, `ORCHESTRATOR.md`).

## Commands (all exist in `smartchat/package.json`)
| Task | Command |
|---|---|
| Install | `npm ci` (in sandboxes: `ELECTRON_SKIP_BINARY_DOWNLOAD=1 npm ci`), then `node_modules/.bin/prisma generate` |
| Typecheck | `npm run typecheck` (= `typecheck:node` + `typecheck:web`) |
| Tests | `npx vitest run` (or `npm run test:run`, which rebuilds better-sqlite3 for Node first) |
| Lint | `npm run lint` (ratchet vs. baseline: `npm run lint:ratchet`; `-- --update` lowers it) |
| Dev app | `npm run dev` |
| Build | `npm run build` |

### Native `better-sqlite3` rebuild dance
The same `.node` binary cannot serve both runtimes.
- Tests need it built for **Node**: `npm run test:rebuild:node` (`npm rebuild better-sqlite3`).
- `npm run dev` / packaged app need it built for **Electron**: `npm run test:rebuild:electron`.
- After running tests, rebuild for Electron before `npm run dev` again.

### Env vars
- `GEMINI_API_KEY`: required by `train/Annotate_Data.ts` (no key is committed).
- `SMARTCHAT_LOG_LEVEL`: `debug|info|warn|error|silent` for the logger.

### Logger
`src/main/utils/logger.ts`: `createLogger('scope')` returns `{debug,info,warn,error,child}`; dependency-free, so it is
safe to import from main, workers and (relatively) the renderer. New code should use it instead of bare `console.*`.

## Guardrails (PLAN section 3, every unit)
1. Gates before refactoring: suite green, hermetic, in CI.
2. Net first: characterization tests pin a file's behaviour before it changes. Bug fix: first commit is a failing test (`it.fails`), the fix commit flips it.
3. Never mix fix and refactor. Refactor commits are behaviour-preserving (tests unchanged and green); fix commits change behaviour and tests, separately.
4. Prove new tests bite: reverting the fix (or mutating the key line) must make the new test fail; state this in the PR.
5. File ownership + hotspot locks (below). A unit edits only its declared files; others get only mechanical import-path updates.
6. Contract changes are explicit: IPC channel, preload API, plugin SDK, DB schema, worker message change both sides and the contract test together. DB changes are additive `schema-migrations.ts` entries with an upgrade test.
7. Per-PR gate: `npm run typecheck`, full `vitest run` (0 failures, 0 unhandled errors), lint ratchet (no rule count may increase), coverage of owned files must not drop.
8. Small units (< ~400 changed non-test, non-move lines), merged quickly.
9. Human smoke tests (units marked 🔎) are queued for the owner; agents cannot exercise real WhatsApp login, scroll feel, macOS quit, packaged builds.

## Hotspot locks (only one in-flight unit may modify each at a time)
| Lock | Files |
|---|---|
| `IPC` | `src/main/ipcHandlers.ts`, `src/main/ipc/**` |
| `PRELOAD` | `src/preload/index.ts`, `src/preload/index.d.ts`, `renderer/src/services/{IAPIService,api.service}.ts`, `renderer/tests/mocks/mockApiService.ts` |
| `DI` | `src/main/ServiceContainer.ts`, `src/main/workers/whatsapp/bootstrapWorkerRepositories.ts` |
| `BOOT` | `src/main/index.ts` |
| `SCHEMA` | `prisma/schema.prisma`, `src/main/db/schema-migrations.ts`, `src/main/auth.ts` |
| `WABRIDGE` | `workers/bridge/WAWorkerBridge.ts`, `workers/whatsapp/whatsappWorker.types.ts`, `routing/workerCommandRouter.ts` |
| `WASYNC` | `workers/whatsapp/services/WorkerHistorySyncManager.ts`, `socket/workerConnectionManager.ts` |
| `MSGREPO` | `services/messages/MessageRepository.ts`, `utils/messageUtils.ts` |
| `KHOST` | `kernel/plugins/PluginHost.ts`, `kernel/KernelBootstrapper.ts`, `kernel/ipc/contributionIpc.ts` |
| `USEMSG` | `renderer/.../chat/hooks/useMessages.ts`, `MessageView.tsx`, `ChatLayout.tsx` |

Constructor-signature edits to `DI` files are small: allowed without the lock, merged last in their batch, called out in the unit report.

## Out of scope
- **Prettier / mass formatting** is out of scope (owner decision). Do not reformat files or run `npm run format`.

## Other
- Old audit documents are archived in `smartchat/docs/audits/archive/`.
