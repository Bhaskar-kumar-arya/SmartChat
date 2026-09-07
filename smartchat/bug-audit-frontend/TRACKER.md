# Frontend Bug Audit Tracker

Single source of truth. Read [`README.md`](./README.md) for the session protocol
and the frontend bug-class checklist. Update the status table and append findings
here. Fix phase → [`FIX_PLAN.md`](./FIX_PLAN.md) (created once auditing is far
enough along).

Statuses: `TODO` · `IN PROGRESS` · `DONE (<n> findings)` · `BLOCKED`

## Status

| # | Slice | Status | Last touched | Notes |
|---|-------|--------|--------------|-------|
| F1 | Preload bridge & IPC surface | DONE (6 findings) | 2026-09-07 | 1 high, 2 med, 3 low |
| F2 | App shell, providers, contributions | DONE (7 findings) | 2026-09-07 | 2 med, 5 low |
| F3 | Chat data hooks (backend event sync) | IN PROGRESS | 2026-09-07 | highest bug density expected — async races, event lifecycle |
| F4 | Chat list & layout & nav UI | DONE (7 findings) | 2026-09-07 | 2 med, 5 low |
| F5 | Message view & rendering | TODO | — | check markdown / media URL / keys / virtualization |
| F6 | Message input & composition | TODO | — | mentions, file queue, audio recorder |
| F7 | Search UI | TODO | — | search-as-you-type out-of-order responses |
| F8 | AI chat UI | TODO | — | streaming abort/race, citation markdown XSS |
| F9 | Extensions / plugins UI | TODO | — | webview sandbox, plugin-supplied content |
| F10 | Overlays & modals | TODO | — | focus trap, portal cleanup, scroll lock |
| F11 | Common components & utils | TODO | — | |
| F12 | Cross-cutting pass | TODO | — | do only after F1–F11 |

## Summary counts

| Severity | Count |
|----------|-------|
| crit | 0 |
| high | 0 |
| med  | 0 |
| low  | 0 |

_(per-slice counts in the status table; reconcile totals here after F1–F11)_

## Baseline (record before fix phase)

- `npm run typecheck:web` — not yet recorded
- `npm run test:run -- src/renderer` — not yet recorded (expected ~319 pass)

---

# Findings

## Slice F1 — Preload bridge & IPC surface

Audited: `preload/index.ts`, `preload/overlay-preload.ts`, `preload/panel-preload.ts`,
`preload/index.d.ts`, `renderer/src/services/{api.service,IAPIService}.ts`,
`renderer/src/context/APIContext.tsx`. Cross-checked main-side handlers in
`src/main/ipcHandlers.ts` + `src/main/ipc/ipcGuards.ts` for the trust boundary.

### [F1-01] high — src/preload/index.ts:428,435
**What:** The full `@electron-toolkit/preload` `electronAPI` is exposed to the
renderer as `window.electron`. That object includes `ipcRenderer.invoke/send/
sendSync/on/postMessage` with **no channel allowlist** (any IPC channel is
reachable) and `process` with a `get env()` that returns a copy of the entire
main/preload `process.env`.
**Why it's a bug:** The renderer only ever uses `window.electron.process.versions`
(`components/common/Versions.tsx:4`). Everything else is unused attack surface:
any XSS in the renderer, or a malicious/compromised renderer dependency, can call
every `ipcMain.handle` channel directly (bypassing the curated `window.api`
wrapper) and read secrets out of `process.env`. The `isTrustedSender` guard only
covers a handful of handlers, so most channels are fully exercisable this way.
**Fix idea:** Don't call `exposeElectronAPI()` / expose `electronAPI`. Expose a
hand-written minimal object: `contextBridge.exposeInMainWorld('electron', {
process: { versions: process.versions } })`.
**Status:** open

### [F1-02] med — src/renderer/src/services/api.service.ts:213 (handler src/main/ipcHandlers.ts:399)
**What:** `api.getProviderKeys()` → `get-provider-keys` returns the **plaintext**
AI provider API keys (`AIService.getProviderKeys()` → `aiKeyService.getKeys()`) to
the renderer as `Record<string,string>`.
**Why it's a bug:** The renderer only needs to know whether a provider is
configured (to render the settings UI state) — it never needs the secret value.
Shipping the raw keys into renderer JS memory means any XSS or third-party
renderer script can exfiltrate them, and they show up in a renderer heap
snapshot / devtools. (Backend audit pass 1 follow-up S6-01 already flags leaked
keys.)
**Fix idea:** Return masked values or `Record<string, boolean>`; keep the real
key in main. If a masked preview is needed, send only the last 4 chars.
**Status:** open

### [F1-03] med — src/preload/overlay-preload.ts:42,46-53
**What:** The overlay preload relays IPC payloads into the guest page with
`window.postMessage({ channel, args: [payload] }, '*')` — wildcard target origin —
for `smartchat:init` (theme tokens) and `smartchat:send` / `smartchat:receive`
(overlay message payloads). Additionally both the `smartchat:send` and
`smartchat:receive` IPC handlers re-post the payload under **both** the
`smartchat:send` and `smartchat:receive` channel names.
**Why it's a bug:** (a) `'*'` means if the overlay `<webview>` navigates to or
embeds any third-party/plugin-controlled origin, that content receives every
overlay payload. (b) The send/receive cross-wiring means a guest listening for
`smartchat:receive` also fires on outbound `smartchat:send` (and vice versa) —
echoed/duplicated events, and outbound data delivered to an inbound handler.
**Fix idea:** Post with the guest's actual origin (or at least the app's known
origin), and keep `send` vs `receive` as distinct one-directional channels.
**Status:** open

### [F1-04] low — src/preload/index.ts:205
**What:** `aiChatStream` builds its IPC channel id as `` `ai-chat-${Date.now()}` ``
— millisecond timestamp only, no random/counter component.
**Why it's a bug:** Two AI streams started within the same millisecond (e.g. a
user message + an auto/system prompt fired together) get the same `channelId`,
so their `-chunk` / `-end` / `-error` events collide — chunks from one stream are
delivered to the other's callbacks, and the first `-end` tears down both.
**Fix idea:** Append a random suffix or monotonic counter:
`` `ai-chat-${Date.now()}-${crypto.randomUUID()}` ``.
**Status:** open

### [F1-05] low — src/preload/index.ts:204-226
**What:** The per-stream `-chunk` / `-end` / `-error` listeners registered by
`aiChatStream` are only removed inside the `-end` and `-error` handlers. There is
no disposer returned to the renderer and `abortAiChat` (invoke only) does not
remove them.
**Why it's a bug:** The main side does send `-end` on abort and on error, so the
normal path is fine, but if a stream never terminates (backend hang, or the AI
component unmounts / the user navigates away and the backend reply is dropped)
the three `ipcRenderer` listeners for that `channelId` stay registered for the
life of the window. Slow listener growth over a long session with many
AI chats.
**Fix idea:** Have `aiChatStream` return a disposer that `removeAllListeners` for
the three channels; call it from the hook's `useEffect` cleanup and on abort.
**Status:** open

### [F1-06] low — src/preload/panel-preload.ts:64-76
**What:** `__smartchat.api.events.on(event, handler)` uses the module-level
`panelId`, which is `''` until `__smartchat._init(id, tokens)` is called. It also
fire-and-forgets the subscribe (`void ipcRenderer.invoke(...)`).
**Why it's a bug:** A panel script that calls `api.events.on(...)` during module
init (before `_init`) sends `kernel:panel:events:subscribe` with an empty
`panelId` — the subscription silently targets nothing, and the returned cleanup
later unsubscribes `''` too. The discarded invoke result hides a rejected
subscription.
**Fix idea:** Queue `on()` calls until `panelId` is set (resolve in `_init`), and
surface subscribe failures.
**Status:** open


## Slice F2 — App shell, providers, contributions

Audited: `App.tsx`, `main.tsx`, `context/ContributionContext.tsx`, `context/APIContext.tsx`,
`hooks/useContributions.ts`, `utils/whenCondition.ts`, `utils/contributionUtils.tsx`.

### [F2-01] med — src/renderer/src/App.tsx:89
**What:** `handleSetSyncFullHistory` sets `isRegeneratingQr = true`, clears the QR, then
`await api.setSyncFullHistory(full)` with no `try/catch/finally`, and the `onClick` callers
don't `.catch`.
**Why it's a bug:** on the QR screen, clicking a sync-mode option calls this. If the IPC call
rejects (or just never triggers a fresh `onWaQr` because the backend errored), `isRegeneratingQr`
is never reset and `qr` stays `null`, so the QR pane is stuck on the "Generating new QR code..."
spinner forever — the user can't link the device without restarting the app. Also produces an
unhandled promise rejection.
**Fix idea:** wrap in `try { ... } finally { }` (or reset `isRegeneratingQr` on the next
`onWaQr`), and have the backend guarantee a QR re-emit; surface an error toast on reject.
**Status:** open

### [F2-02] med — src/renderer/src/context/ContributionContext.tsx:15-38
**What:** the effect fires `api.getContributions().then(setSnapshot)` and *then* registers
`api.onContributionsUpdated(setSnapshot)`. The initial fetch is not cancelled/superseded when an
update event arrives first.
**Why it's a bug:** if a contribution registry change is pushed from main between effect-mount and
the `getContributions()` promise resolving (plugin activating during startup), the update event
lands first and sets the fresh snapshot, then the slower initial fetch resolves with the older
snapshot and clobbers it. The UI then shows stale contributions (missing menu items / panels)
until the next update. `mounted` guards unmount but not this ordering.
**Fix idea:** track whether an update has already been applied (or a request seq) and ignore the
initial `.then` if so; or subscribe before fetching and treat the fetch as lowest priority.
**Status:** open

### [F2-03] low — src/renderer/src/App.tsx:27-33
**What:** initial `api.getSyncFullHistory().then((full) => setSyncFullHistory(full))` effect has
no mounted/abort guard.
**Why it's a bug:** if `App` unmounts before the IPC resolves (fast transition to `ready`, or
StrictMode remount in dev), `setSyncFullHistory` runs after unmount → React warning; harmless in
prod but inconsistent with the guarded pattern used elsewhere.
**Fix idea:** add a `let alive = true` flag with cleanup, matching `ContributionContext`.
**Status:** open

### [F2-04] low — src/renderer/src/App.tsx:43-51, 132-316
**What:** `onWaConnected` can set `appState = 'connected'` (when `data.isCatchup`), but the render
has branches only for `'ready'`, `'syncing'`, `'qr'`, and an else. `'connected'` falls into the
else branch.
**Why it's a bug:** during a catch-up reconnect the setup card shows the generic init spinner with
whatever text `syncStatus` currently holds (often the stale "Initializing connection..." or a
leftover sync status), which misrepresents the state to the user.
**Fix idea:** give `'connected'` its own copy ("Reconnecting / catching up…") or map it to the
`'syncing'` visual.
**Status:** open

### [F2-05] low — src/renderer/src/utils/contributionUtils.tsx:27-31
**What:** `subMenu: sub.subMenu ? mapSubMenuItems(...) : undefined` and the matching
`onClick: sub.subMenu ? undefined : ...`. An empty array `sub.subMenu === []` is truthy.
**Why it's a bug:** a plugin that declares `subMenu: []` (or one whose children all get filtered
out upstream) produces a menu entry with an empty submenu and no `onClick` — a dead, unclickable
item with a hover arrow.
**Fix idea:** check `sub.subMenu && sub.subMenu.length > 0`.
**Status:** open

### [F2-06] low — src/renderer/src/hooks/useContributions.ts:7-9
**What:** on the "no contributions for this slot" path the hook returns a freshly-allocated `[]`
literal every render.
**Why it's a bug:** consumers that put the result in a `useEffect`/`useMemo` dependency array (or
pass it as a prop to a memoized child) see a new reference every render → effect re-runs / child
re-renders on every parent render while the slot is empty (the common case).
**Fix idea:** return a module-level frozen `EMPTY: [] as const` for the empty path.
**Status:** open

### [F2-07] low — src/renderer/src/utils/whenCondition.ts:42-45
**What:** `neq` is `ctxValue !== value`; when `condition.field` is absent from the context,
`ctxValue` is `undefined` and the comparison is true.
**Why it's a bug:** a `{ field: 'x', op: 'neq', value: 'foo' }` gate is meant to hide a
contribution when `x === 'foo'`, but it also *passes* (shows it) for any context that simply
lacks `x` — likely not the plugin author's intent, and asymmetric with `eq`.
**Fix idea:** treat a missing field as a non-match for `neq`/`nin` (require `condition.field in
context`), or document the semantics explicitly.
**Status:** open

## Slice F3 — Chat data hooks
_none yet_

## Slice F4 — Chat list & layout & nav UI
_none yet_

## Slice F5 — Message view & rendering
_none yet_

## Slice F6 — Message input & composition
_none yet_

## Slice F7 — Search UI
_none yet_

## Slice F8 — AI chat UI
_none yet_

## Slice F9 — Extensions / plugins UI
_none yet_

## Slice F10 — Overlays & modals
_none yet_

## Slice F11 — Common components & utils
_none yet_

## Slice F12 — Cross-cutting pass
_none yet_
