# SmartChat Frontend Bug Audit

Same partitioned, multi-session method as the backend audit
(`../bug-audit/`), applied to the **renderer / frontend**.

**Scope:** `src/renderer/src/**` (React app) and `src/preload/**` (the
contextBridge / IPC surface). Backend (`src/main/**`, `packages/sdk`) is done and
out of scope here — see `../bug-audit/`.

~21k LOC of TSX/TS in the renderer + ~0.7k in preload. React 18 + hooks, two
Context providers (`APIContext`, `ContributionContext`), no Redux. Data reaches
the UI through `window.api` (preload) → `api.service.ts` → hooks that also
subscribe to backend push events.

---

## How to run a session (every time)

1. **Read [`TRACKER.md`](./TRACKER.md).** Single source of truth.
2. Pick the **lowest-numbered slice with status `TODO`**. Set it `IN PROGRESS`
   (with today's date). Commit that one-line change.
3. Read **every `.ts`/`.tsx` file in the slice**, plus its tests
   (`src/renderer/tests/**` mirrors `src/renderer/src/**`).
4. Apply the frontend bug-class checklist below. **Confirm each finding against
   the real code paths** — trace where the hook is used, what re-renders it,
   what cleans it up. No speculative findings.
5. Append confirmed findings to the slice's section in `TRACKER.md` (finding
   format below).
6. Set slice status `DONE (<n> findings)` with the date. Commit `TRACKER.md`.
7. Report a short summary to the user.

**Audit only — do not fix during the audit.** Fixing is a separate phase driven
by `FIX_PLAN.md` after enough slices are done.

Ran out of context mid-slice: record partial findings, set status
`IN PROGRESS — done through <file>`, commit. Next session resumes there.

Slices 1–11 are independent → safe to run in parallel sessions (assign
non-overlapping slices, each session commits only its own rows + section, and
leaves the summary-count cell for a final reconciliation). Slice 12
(cross-cutting) is last.

---

## Frontend bug-class checklist (apply to every slice)

**This list is a floor, not a ceiling.** It names the classes most likely to be
missed on a skim — always sweep for all of them — but report *any* defect you can
substantiate: wrong logic / spec violations, bad conditionals, off-by-one, wrong
formatting or number/date/timezone handling, security holes (XSS, unsafe links /
`javascript:` / `data:` URLs, IPC or preload escape, `<webview>` sandbox gaps,
secrets exposed to the renderer), missing input validation or output encoding,
accessibility breakage that blocks a task (unlabeled controls, keyboard traps,
lost focus), state that can't recover from an error, race conditions,
memory/listener growth over a long session, performance cliffs (re-render storms,
unvirtualized long lists, expensive work on every keystroke), broken empty/error/
loading states, and mismatches with the backend's actual event/response shapes.
If it would surprise or harm a user, or violate the component's evident intent,
it's in scope.

- **Effect cleanup / listener leaks**: `useEffect` that subscribes to a
  `window.api` event, `window` event, timer, interval, `ResizeObserver`,
  `IntersectionObserver`, media element, or AbortController and does **not**
  return a cleanup — leaks and double-fires after re-mount / dep change. Also:
  cleanup that removes a *different* function reference than was added.
- **Stale closures / missing deps**: handler or effect capturing an outdated
  prop/state value; `useEffect`/`useCallback`/`useMemo` dep arrays missing a
  referenced value (or deliberately lying — check the consequence); event
  subscription registered once with `[]` but its callback reads state.
- **setState-after-unmount / async ordering**: `await` (fetch, IPC, dynamic
  import) then `setState` with no "is still mounted / is still the current
  request" guard. **Out-of-order responses**: request for chat A resolves after
  a newer request for chat B → B's view shows A's data. Rapid chat switching,
  search-as-you-type, pagination.
- **Optimistic update reconciliation**: local echo / temp message not replaced
  or de-duped when the authoritative backend event arrives (dupes, stuck
  "sending", wrong id). Reaction / status / edit races.
- **List keys**: array index or non-unique value as `key` on a list that
  reorders, filters, or prepends → wrong component reuse, lost input focus /
  scroll / local state, wrong item animated.
- **XSS / unsafe rendering**: `dangerouslySetInnerHTML`, markdown renderers
  (AI citations, message text), plugin/extension-supplied strings or HTML,
  `<webview>`/`<iframe>` `src`, `<a href>` allowing `javascript:` / `data:`,
  image `src` from message content. Trace the sanitization (or absence).
- **IPC / preload trust boundary**: preload exposing more than a fixed channel
  allowlist; renderer passing unvalidated data that the main side trusts;
  `ipcRenderer` leaked onto `window`; event payloads from main rendered without
  shape checks.
- **Render-time work / perf**: expensive compute or new object/array/function
  literal created every render and passed as a prop or effect dep → effect
  re-runs, children re-render, subscription churns. Missing `React.memo` on a
  hot list row is a *smell*, not a bug — only flag if it causes a real
  correctness issue (e.g. re-subscribe loop).
- **Error handling**: promise rejection in an event handler with no `.catch`
  (unhandled rejection); no error boundary around a subtree that can throw
  (white screen); IPC error swallowed so the UI silently shows stale/empty.
- **Portals / modals / focus**: portal container not removed on unmount; body
  scroll-lock or `aria-hidden` not restored; focus not trapped / not restored
  to opener; `Escape` / backdrop close missing or doubled.
- **State desync with backend**: a backend event type the hook doesn't handle
  (so UI never updates until reload); cache/query not invalidated; pagination
  cursor drift; unread/badge counts computed two different ways.
- **Navigation races**: unmount during in-flight load; effect keyed on an id
  that changes before the async work finishes; scroll-to-bottom / scroll-restore
  fighting a data update.

---

## Slice map

| # | Slice | Paths (under `src/` ) |
|---|-------|------------------------|
| F1 | Preload bridge & IPC surface | `preload/**`, `renderer/src/services/{api.service,IAPIService}.ts`, `renderer/src/context/APIContext.tsx` |
| F2 | App shell, providers, contributions | `renderer/src/App.tsx`, `renderer/src/main.tsx`, `renderer/src/context/ContributionContext.tsx`, `renderer/src/hooks/useContributions.ts`, `renderer/src/utils/{whenCondition.ts,contributionUtils.tsx}` |
| F3 | Chat data hooks (backend event sync) | `renderer/src/components/chat/hooks/{useChats,useMessages,useChatHierarchy,useSearch}.ts`, `renderer/src/hooks/{useChatNavigation.ts,usePresence.ts}` |
| F4 | Chat list & layout & nav UI | `renderer/src/components/chat/{ChatLayout,ChatList,SidebarRail,ExtensionChatListItem}.tsx`, `renderer/src/components/chat/hooks/useSidebarResize.ts` |
| F5 | Message view & rendering | `renderer/src/components/chat/{MessageView,MessageItem,MessageInfoModal,ReactionsDisplay}.tsx`, `renderer/src/components/chat/messages/**`, `renderer/src/components/common/{MessageStatusTick,WaveformPlayer}.tsx` |
| F6 | Message input & composition | `renderer/src/components/chat/{MessageInput,MentionMenu,MultiFilePreview,DragDropOverlay}.tsx`, `renderer/src/hooks/{useMentions,useMentionSession,useMultiFileQueue,useDragAndDrop,useAudioRecorder,useGiphy}.ts`, `renderer/src/components/picker/EmojiStickerGifPicker.tsx`, `renderer/src/utils/{editorUtils,mentionUtils}.ts` |
| F7 | Search UI | `renderer/src/components/chat/{ChatSearchSidebar,SearchFiltersPanel,SearchResultsPanel}.tsx`, `renderer/src/utils/messagePreview.ts` |
| F8 | AI chat UI | `renderer/src/components/ai/**`, `renderer/src/hooks/{useCitation,useCitationActions}.ts`, `renderer/src/types/ai/**` |
| F9 | Extensions / plugins UI | `renderer/src/components/extensions/**`, `renderer/src/components/panels/**`, `renderer/src/components/chat/ExtensionChat/**`, `renderer/src/hooks/{useExtensionChat,useExtensionLog,useExtensionManager}.ts` |
| F10 | Overlays & modals | `renderer/src/components/overlays/**`, `renderer/src/components/common/{ConfirmModal,SettingsModal}.tsx`, `preload/overlay-preload.ts` |
| F11 | Common components & utils | `renderer/src/components/common/**` (remainder), `renderer/src/utils/{formatters,jidUtils,emojiUtils,emojiData,emojiKeywords,presenceUtils}.ts` |
| F12 | Cross-cutting pass | tree-wide effect-cleanup leaks, unmount-after-async, global listener mgmt, error boundaries, memory growth on chat switch, re-render storms — **do AFTER F1–F11** |

---

## Finding format (append to the slice section in TRACKER.md)

```
### [F<slice>-<nn>] <sev: crit|high|med|low> — <file>:<line>
**What:** one-line description.
**Why it's a bug:** the wrong user-visible behavior + the concrete interaction
that triggers it (which clicks / props / event order).
**Fix idea:** short suggestion.
**Status:** open
```

Severity: **crit** = data loss, security (XSS / IPC escape), or app-wide crash;
**high** = feature visibly broken or wrong data shown in common use; **med** =
wrong in edge cases, recoverable, leak that matters over a long session; **low** =
smell / minor / cosmetic.

---

## Verification (fix phase)

- `npm run typecheck:web`
- `npm run test:run -- src/renderer` (vitest renderer suite; baseline ~319 pass —
  record exact number before fixing)
- Manual: `npm run test:rebuild:electron` then `npm run dev`; exercise the
  touched flow. Watch the devtools console for React warnings (keys, missing
  deps, setState-after-unmount), and use the React Profiler for suspected
  re-render / re-subscribe loops.

---

## Reference

- Backend audit + fixes: `../bug-audit/` (README, TRACKER, FIX_PLAN). Several
  backend fixes added new event types / response shapes (e.g. FAILED message
  status S2-02, `outOfWindow` chat-list flag S4-02, citation persistence
  changes S6-07) — the renderer side of those is fair game for this audit.
- `window.api` shape: `src/preload/index.d.ts`.
- Renderer tests: `src/renderer/tests/**`.
