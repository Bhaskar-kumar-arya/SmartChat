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
| F3 | Chat data hooks (backend event sync) | DONE (11 findings) | 2026-09-07 | 1 high, 6 med, 4 low — async races, presence expiry/JID, hierarchy orphans |
| F4 | Chat list & layout & nav UI | DONE (7 findings) | 2026-09-07 | 2 med, 5 low |
| F5 | Message view & rendering | DONE (14 findings) | 2026-09-07 | 1 high, 5 med, 8 low — markdown link XSS, template-button URL scheme, pagination lock-up, reaction self-JID |
| F6 | Message input & composition | DONE (14 findings) | 2026-09-07 | 1 high, 6 med, 7 low — voice note mis-delivery on chat switch, mouse mention pick broken, stale mentions |
| F7 | Search UI | DONE (8 findings) | 2026-09-08 | 1 high, 3 med, 4 low — ChatSearchSidebar out-of-order responses, date-range timezone/inclusive-end |
| F8 | AI chat UI | IN PROGRESS | 2026-09-08 | streaming abort/race, citation markdown XSS |
| F9 | Extensions / plugins UI | IN PROGRESS | 2026-09-08 | webview sandbox, plugin-supplied content |
| F10 | Overlays & modals | DONE (13 findings) | 2026-09-08 | 6 med, 7 low — webview insecure-content pref, send/receive cross-wiring, no Escape/focus-trap on common modals, required-checkbox validation gap, optimistic-toggle no-revert |
| F11 | Common components & utils | IN PROGRESS | 2026-09-08 | |
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
_none yet_

## Slice F9 — Extensions / plugins UI
_none yet_

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
_none yet_

## Slice F12 — Cross-cutting pass
_none yet_
