# SOLID / component-design audit: renderer (`src/renderer/src/**`)

Scope: 124 files, 16,143 LOC, at commit `8e0f5b8`. This audit is read-only and is a delta on top of `UICHAT.md` §2/§4, `UIAPP.md` §2/§4 and `PLAN.md` §5.
Items those files already cover are mapped to their ids. Only NEW items get new units.
Measurements come from a TypeScript-AST script (function spans, `useState`/effect/ref counts, `*Props` members), not from estimates.

## 0. Measurements

**Components/modules > 250 LOC (17):**

| File | LOC |
|---|---|
| MessageItem.tsx | 713 |
| ChatList.tsx | 637 |
| MessageInput.tsx | 546 |
| EmojiStickerGifPicker.tsx | 447 |
| ChatLayout.tsx | 425 |
| MediaMessages.tsx | 423 |
| useChats.ts | 419 |
| AISmartInput.tsx | 396 |
| useMessages.ts | 390 |
| MessageView.tsx | 377 |
| AIChatSidebar.tsx | 363 |
| useAIStream.ts | 349 |
| TemplateMessage.tsx | 338 |
| App.tsx | 311 |
| AISettingsModal.tsx | 277 |
| SystemStubRegistry.tsx | 268 |
| OverlayShell.tsx | 267 |

`api.service.ts` (306) and `emojiKeywords.ts` (604, data) are excluded.

**Functions/hooks > 60 lines: 67 in total.** Top 20 (lines):

| Function (file:line) | Lines |
|---|---|
| ChatList (ChatList.tsx:42) | 595 |
| MessageItem (MessageItem.tsx:189) | 521 |
| MessageInput (MessageInput.tsx:30) | 517 |
| EmojiStickerGifPicker (EmojiStickerGifPicker.tsx:30) | 418 |
| ChatLayout (ChatLayout.tsx:27) | 399 |
| useChats (useChats.ts:32) | 388 |
| useMessages (useMessages.ts:12) | 379 |
| AISmartInput (AISmartInput.tsx:42) | 353 |
| AIChatSidebar (AIChatSidebar.tsx:19) | 345 |
| useAIStream (useAIStream.ts:15) | 335 |
| MessageView (MessageView.tsx:31) | 310 |
| TemplateMessage (TemplateMessage.tsx:31) | 308 |
| App (App.tsx:10) | 300 |
| AISettingsModal (AISettingsModal.tsx:14) | 264 |
| useChats subscription effect (useChats.ts:120) | 263 |
| OverlayShell (OverlayShell.tsx:22) | 246 |
| ChatSearchSidebar | 219 |
| SettingsModal | 214 |
| useAudioRecorder | 212 |
| FormModal | 186 |

Non-component offenders further down the list:
- `ChatList` context-menu JSX closure: 150 (`:416`)
- `useAIStream.startStream`: 140 (`:77`)
- `useChats.handleNewMessage`: 138 (`:123`)
- `useChatHierarchy` memo: 108
- `MessageItem.renderContent`: 65 (`:441`)

**`useState` per component, top 10** (useState / effects / refs):

| Component | useState | effects | refs |
|---|---|---|---|
| MessageItem | 13 | 4 | 3 |
| ChatLayout | 11 | 6 | 1 |
| ChatList | 11 | 1 | 2 |
| App | 7 | 2 | 1 |
| AIChatSidebar | 7 | 2 | 3 |
| EmojiStickerGifPicker | 7 | 3 | 1 |
| useChats | 6 | 4 | 5 |
| useMessages | 6 | 4 | 4 |
| AIChatExportButton | 5 | 0 | 0 |
| AISettingsModal | 5 | 3 | 1 |

MessageView has only 5 `useState`, but 6 effects and 13 refs, which makes it the most ref-heavy component.

**Components with > 10 props:**
- `MessageViewProps` has 15, 8 of them callbacks.
- `BaseModalProps` has 11. That is acceptable for a primitive.
- Borderline: `AIMessageBubbleProps` 10, and `AISmartInputProps` / `MultiFilePreviewProps` / `ConfirmModalProps` 9 each.

**`IAPIService`:**
- 102 methods, consumed by 34 `useAPI()` call sites.
- Distinct methods per consumer: max 14 (`useMessages`), then 8 (`App`) and 7 (`MessageItem`, `useAIChatSessions`). 22 of the 34 consumers use 3 or fewer.
- 9 methods have zero renderer callers: `muteChat`, `unmuteChat`, `pinChat`, `unpinChat`, `get/setSyncFullHistory`, `resolveAllCitations`, `searchMentionChats`, `extensionGetDocs`.

## 1. SRP: components and hooks mixing fetching, IPC, state machines and rendering

- [SOLID-R-01] SRP `components/chat/MessageItem.tsx:189` — 713 LOC, 13 `useState`. It mixes 9 responsibilities in one component: content parse/unwrap; type classification; quote resolution; sender colour; reaction menu; dropdown positioning; edit mode; receipts/sticker-favourite IPC; plugin actions. Fix: `useParsedMessage` plus sub-components. covered by: R-UICHAT-06 (+ R-UICHAT-03 for `getMyJid`).
- [SOLID-R-02] SRP `components/chat/ChatList.tsx:42` — 637 LOC, 11 `useState`. Covers list rendering, search, indexing, logout, 2 modals, context-menu building (`:265`), per-type preview icons (`:171`) and row markup. covered by: R-UICHAT-08.
- [SOLID-R-03] SRP `components/chat/ChatLayout.tsx:27` — 425 LOC, 11 `useState`, 6 effects, 5 IPC subscriptions (`setActiveChat`, `onExtensionFocus`, `onOpenChat`, navigationBus, `onChatUpdated` for the header). It also owns: active-chat identity (jid, name and picture as 3 separate states); extension-chat routing; the multi-file send workflow; AI/search panel toggles; the profile overlay; a 4-way main-stage render switch (`:280-385`). Fix: `useActiveChat()` (selection + all 5 subscriptions), `useSidePanels()`, and `<ChatHeader>`/`<ChatMainStage>` presentational components. NEW. R-UICHAT-05 only fixes bugs here.
- [SOLID-R-04] SRP `components/chat/MessageInput.tsx:30` — 546 LOC (one 517-line function). It combines: a contentEditable editor with caret bookkeeping; mention menu; slash-command dispatch (`:225-260`, IPC + `console.log`); voice recording; emoji picker; clipboard paste → `saveTempFile` (`:354-370`); attach; reply bar. Fix: `useComposerEditor`, `useSlashCommands`, `usePasteAttachments` and a `<VoiceRecorderBar>`. NEW. R-UICHAT-09 only fixes bugs.
- [SOLID-R-05] SRP `components/chat/hooks/useMessages.ts:12` — a 379-line hook with 4 separate concerns: initial load / DB paging / on-demand WhatsApp fetch with a timeout; jump window; 5 IPC event subscriptions, each hand-patching the array (`:213-300`); send/edit/delete/download commands. `useChats.ts:120` repeats the same subscribe-and-patch pattern for the same 3 events (a 263-line effect). Fix: pure `messageListReducer(state, event)` with table tests; the hook becomes subscribe → dispatch. covered by: R-UICHAT-02/03 (paging, stability) and R-UICHAT-07 (chat side). The message-side reducer split is NEW.
- [SOLID-R-06] SRP `components/picker/EmojiStickerGifPicker.tsx:30` — 447 LOC, 7 `useState`. Handles 3 tabs, the GIPHY fetch, favourite-sticker CRUD, a URL→temp-file download ×3 (`:98,114,132`), a remove-confirm modal and `-2/-1` sentinel pack selection. Fix: `<EmojiTab>/<GifTab>/<StickerTab>` + `useFavoriteStickers` + `useRemoteMediaToTemp`. NEW. The god-component note is in UICHAT §2.3, but no unit owns it.
- [SOLID-R-07] SRP `components/ai/AIChatSidebar.tsx:19` — 363 LOC. Fetches chats, tools, models and options (`:86-89`), orchestrates sessions and the stream, edits the title, and hand-syncs `setMessages` + `messagesRef` in 5 places (`:130,206,215,272,294`). Fix: a `useAIChatResources()` container hook plus the stream-hook contract fix (see SOLID-R-23). NEW, adjacent to R-UIAPP-05.
- [SOLID-R-08] SRP `App.tsx:10` — 7 `useState`, 7 IPC subscriptions, a connection state machine, and inline QR/sync/connected screens (`:122-311`). covered by: R-UIAPP-08. Extend it to extract `<SyncScreen>`/`<QrScreen>`.
- [SOLID-R-09] SRP `components/chat/messages/MediaMessages.tsx:105,188,283` — Image, Sticker and Video each call `useAPI()` and each re-implement the download/expired state machine. Fix: a `useMediaDownload(localURI, onDownload)` hook. NEW. The duplication is noted in UICHAT §2.4 item 5, but no unit owns it. Fold it into R-UICHAT-06.
- [SOLID-R-10] SRP `components/chat/messages/TemplateMessage.tsx:31` — 308 lines. A renderer that also sends messages (`api.sendMessage` at `:181`). covered by: UICHAT §2.7 (no unit). NEW unit via ChatActionsContext (R-SOLID-R-01).

## 2. OCP: central switches that must be edited to add a variant

- [SOLID-R-11] OCP `MessageItem.tsx:24-33,202,413-438,548-550` — `MESSAGE_REGISTRY` exists, but it is not open for extension. Adding a message kind means editing: the `isX` flag chain (`:413-418`); `getMessageTypeKey` (`:426-436`); `MEDIA_TYPES`/`TEXT_TYPES`; the per-type caption lines (`:548-550`); the bubble-class logic (`:507-512`); the system-type list (`:202`); `ChatList.getMessageIcon` (`:171`); `utils/messagePreview.ts:9`; the `MessageType` union. That is 6 files for one new kind. Fix: one `messageKinds.ts` descriptor table `{match(msg, raw), Renderer, captioned, bubbleClass, isMedia, previewLabel, icon}`; every site iterates it. NEW.
- [SOLID-R-12] OCP/LSP `types/message.types.ts:34` — the `MessageType` union omits `system`, `call`, `callLogMesssage`, `scheduledCallCreationMessage` and `ciphertext`, while `MessageItem.messageType` is `string`. `messagePreview.ts:7` casts `as MessageType`, so its "exhaustive" `never` check is a lie. The misspelling `callLogMesssage` is hard-coded twice. Fix: complete the union, type `messageType` with it, and use one constant for the misspelled wire value. NEW.
- [SOLID-R-13] OCP `messages/SystemMessage.tsx:18-33` — `SYSTEM_STUB_REGISTRY` is used consistently for stubs (27 keys, single consumer), but it is incomplete in 3 ways: Call types bypass it through a hard-coded fallback with `(content as any).callLog`; The "is system" predicate is duplicated in `MessageItem.tsx:202` and `SystemMessage.tsx:23`; Renderers take positional `(content, onSelectChat, msg)`, and `NameChip` hard-codes inline styles. Fix: a registered `CALL_LOG` entry, an exported `isSystemMessage(msg)`, and a typed `StubRenderer` props object. NEW. Tests for the registry are listed in UICHAT §3 but not owned.
- [SOLID-R-14] OCP `MessageItem.tsx:649-677`, `ChatList.tsx:265-306`, `MessageInput.tsx:232-258` — contribution execution is written inline 3 times, each with its own `when`-context construction, `executeContribution` call and error handling (`.catch(console.error)`). `mapSubMenuItems` (`utils/contributionUtils.tsx:17`) is used only by ChatList, so message actions silently do not support `subMenu`. Fix: `useContributionMenu(slot, whenCtx, baseCtx)` that returns menu items, and `buildChatWhenContext`/`buildMessageWhenContext` in `utils/`. NEW.
- [SOLID-R-15] OCP `main/kernel/contributions/ContributionPoints.ts:108-122` vs renderer — 6 of the 15 slots are consumed nowhere in the renderer: `message-renderer` (the natural OCP extension point for SOLID-R-11); `keyboard-shortcut`; `status-bar-item`; `chat-filter`; `chat-sort-strategy`; `chat-badge`, which is subscribed and discarded at `ChatList.tsx:262-263`; so is `sidebar-panel` there. Fix: decide per slot whether to render it through a `<ContributionOutlet slot>` host or to reject it at manifest validation. covered by: R-KRN-11 (badge/completion/pipeline only). The rest is NEW, a decision item.
- [SOLID-R-16] OCP `overlays/ModalPortal.tsx:18,93-115` — the modal kind is a `switch` plus `cancelValueForType`. It is small (3 kinds). Fix: a `{form|confirm|alert: {Component, cancelValue}}` map. covered by: R-UIAPP-06 (fold in).
- [SOLID-R-17] OCP `ChatLayout.tsx:280-385` — the main stage is a nested ternary (plugin panel / extension chat / WhatsApp chat / empty), with extension-prefix sentinels. covered by: R-UICHAT-05 (prefix) + R-UIAPP-04 (extension-chat decision). The `<ChatMainStage>` extraction is in NEW R-SOLID-R-06.
- [SOLID-R-18] OCP `common/SettingsModal.tsx:15,51,88-130` — the built-in "general" tab is special-cased beside the plugin `settings-page` contributions, and AI settings live in a separate modal. Fix: built-in pages register through the same `{id,label,Component}` list. Low priority. NEW (fold into R-UIAPP-06).

## 3. LSP: contracts accepted but ignored, or different by branch

- [SOLID-R-19] LSP `MessageItem.tsx:522-536` — the quote click first does `document.getElementById` + `classList.add('highlight-pulse')` and calls `onScrollToMessage` only when the DOM node is missing. The prop contract is honoured only on the fallback path, and there are two highlight mechanisms (this one and `MessageView.highlightedId`). Under virtualisation (R-UICHAT-04) the DOM path silently no-ops for off-screen rows. Fix: always call `onScrollToMessage`. NEW. Must land with or before R-UICHAT-04.
- [SOLID-R-20] LSP `messages/MediaMessages.tsx:105,283,381` + `MessageItem.tsx:548-550` — media renderers receive `textContent` but use it only as a margin hint. The caption is rendered by the parent, per type. So a new registry entry cannot own its caption. `DownloadMediaPlaceholder` accepts `MediaMessageProps.mentions`/`textContent` and ignores both (`:61-75`). Fix: the renderer owns the caption (descriptor `captioned`), and the placeholder gets its own props type. NEW (with R-SOLID-R-02).
- [SOLID-R-21] LSP `overlays/{Alert,Confirm,Form}Modal.tsx` (`modalId` prop), `panels/PanelWebview.tsx:8` (`title`) — required or declared props that are never read. covered by: R-UIAPP-06 (modals) / R-UIAPP-02 (PanelWebview).
- [SOLID-R-22] LSP `useMessages.ts:162` (`loadMore` returns `-1` as a sentinel) and `MessageView.tsx:22-23` (`Promise<any>` vs `Promise<void>`). covered by: UICHAT §2.6/§2.9 → R-UICHAT-02 / Z-05.
- [SOLID-R-23] LSP `components/ai/hooks/useAIStream.ts:336-340` — the hook returns a raw `setMessages` **and** the `messagesRef` mirror. Its invariant (`ref === state`) must be maintained by the caller. `AIChatSidebar.tsx:142` (the error path) updates state but not the ref, so later tool/auto-save reads see stale history. Fix: return `replaceMessages(msgs)`/`appendMessage(m)` that update both; stop exporting the ref. covered by: R-UIAPP-05 ("collapse refs"), made explicit here. `useMessages` also exports an unused `setMessages` (`:388`).
- [SOLID-R-24] LSP `tests/mocks/mockApiService.ts` — the mock diverges from `IAPIService` semantics: `sendMessage`/`editMessage` return `content: text` (a raw string, not the JSON the real service returns), so `MessageItem`'s parse takes the warn path in tests; `getAiOptions` returns `gpt-4o`, which is not in the provider list; Overlay members are optional in the interface but always provided by the mock; Every value is `as any`. covered by: R-UIAPP-03 / N-07 (typed mock, drifted defaults).

## 4. ISP: fat props, fat contexts, the fat service

- [SOLID-R-25] ISP `MessageView.tsx:11` — 15 props, 8 of them callbacks relayed to `MessageItem`/`SystemMessageBubble`/stubs (`onSelectChat` goes 4 levels deep). Fix: `ChatActionsContext` (stable callbacks). covered by: UICHAT §2.8 (no unit). NEW unit R-SOLID-R-01.
- [SOLID-R-26] ISP `context/PresenceContext.tsx:172` — the value object is recreated on every render. ChatList reads only `lookupPresence` and ChatLayout reads only `getActivePresence`, yet both re-render (and so does every `MessageItem` under ChatLayout) on each presence event. Fix: an external store plus selector hooks `usePresenceText(jid)` (`useSyncExternalStore`). covered by: UIAPP §2.7 (no unit). NEW unit R-SOLID-R-08.
- [SOLID-R-27] ISP `context/ToastContext.tsx:78` — the value is not memoised, and toast list state lives in the same provider, so every show/dismiss re-renders `MessageView` and `useAIStream` consumers. Fix: `useMemo` the actions, or split the actions context from the list. NEW (R-SOLID-R-08).
- [SOLID-R-28] ISP `context/ContributionContext.tsx:46` + `hooks/useContributions.ts:8` — the context holds one snapshot of all slots. Every `useContributions(slot)` consumer, including one per `MessageItem` row, re-renders when *any* slot changes (for example a plugin's sidebar-panel update). Fix: per-slot selectors. NEW (R-SOLID-R-08). The per-row subscription cost is noted in UICHAT §2.2.
- [SOLID-R-29] ISP `services/IAPIService.ts` — one 102-method interface. Consumers use 1–14 methods each, so the mock, and every test, must satisfy all 102. Fix: define `RendererApi` as an intersection of domain facets (`ChatApi`, `MessageApi`, `SyncApi`, `AiApi`, `ExtensionApi`, `KernelUiApi`, `MediaApi`, `PrefsApi`); hooks declare `Pick<>`/facet deps; mocks are built per facet. Delete or wire the 9 unused methods. `mute/pin/unpin` exist but ChatList's context menu contains only plugin actions, so these built-ins have no UI. covered by: C-03/R-UIAPP-01 (single contract) and R-UIAPP-11 (some dead methods). The facet split and the mute/pin/`resolveAllCitations`/`searchMentionChats` decisions are NEW.
- [SOLID-R-30] ISP/DIP `hooks/useMentionSession.ts:5-25` — 8 options, including the owner's `setInputValue`, `setMentions`, `inputRef` and `autoGrow`. The hook drives its caller's state and DOM instead of owning mention state. There are also two mention engines with different contracts (`useMentions` for the composer, `useMentionSession` for AI). Fix: `useMentionSession` owns the state and returns `{inputProps, menuProps, value, mentions}`. NEW. Mention-highlight duplication is noted in UIAPP §2.6.
- [SOLID-R-31] ISP `AIMessageBubble.tsx:43` (10 props, including `chatList` used only in edit mode) and `AISmartInput.tsx:12` (9). covered by: UIAPP §2.7 prop drilling. Fold into R-SOLID-R-09.

## 5. DIP: reaching past `useAPI()` / context into concretions and globals

- [SOLID-R-32] DIP `panels/PanelWebview.tsx:65,110`, `panels/SidebarPluginTabs.tsx:125-132`, `common/Versions.tsx:4` — direct `window.api`/`window.electron`. covered by: R-UIAPP-02 / C-05. This is the only direct-global IPC left; the composition root at `main.tsx:11-24` is otherwise clean.
- [SOLID-R-33] DIP renderer → `main/**` type imports: `ChatList.tsx:22`; `types/contribution.types.ts:1`; `utils/contributionUtils.tsx:2`; `ModalPortal.tsx:10`; `OverlayShell.tsx:4`; `IAPIService.ts:158,162` covered by: R-UIAPP-09 / C-06.
- [SOLID-R-34] DIP leaf presentational components that pull the service locator: `MessageItem` (7 methods); `MediaMessages` ×3 (`:106,189,382`); `TemplateMessage:37`; `ProfilePicture:23`; `EmojiStickerGifPicker` (3). Rows in an unbounded list each hold IPC-capable closures and fire per-row IPC. Fix: actions come from `ChatActionsContext`; data comes from memoised hooks (`useProfilePicture`, `useSelfJid`). Partly covered by R-UICHAT-03 (`getMyJid`). The rest is NEW (R-SOLID-R-01).
- [SOLID-R-35] DIP `hooks/useGiphy.ts:7,37` — a raw `fetch` to GIPHY plus `import.meta.env` inside the hook, with no seam. Tests must stub global `fetch`. Fix: a `GiphyClient` interface provided through context (default impl in `services/`). NEW (low).
- [SOLID-R-36] DIP/DRY — 8 hand-rolled `document`-level outside-click/Escape listeners: `MessageItem:287` (one per row); `MessageInput:60`; `AISmartInput:97`; `AISettingsModal:70`; `ContextMenu:44-46`; `SearchFiltersPanel:54-55`; `useSidebarResize:42`; `ModalPortal` keydown. Fix: shared `useOutsideClick(ref, cb)` / `useDismissable({escape, outside})`. R-UICHAT-03 adds a hook for `MessageItem` only. Adoption elsewhere is NEW.
- [SOLID-R-37] DIP module singletons (`navigationBus`, `globalCitationCache`, `modalStack`, `cachedThemeTokens`) are imported directly by consumers. covered by: UIAPP §2.7 / R-UIAPP-03 (reset hooks). No further action proposed.

## 6. New refactor units (NEW items only)

Lock `USEMSG` = `useMessages.ts`, `MessageView.tsx`, `ChatLayout.tsx` (PLAN §4.2).
All units: failing/characterisation tests first, behaviour-preserving, `npx vitest run --project renderer` + `npm run typecheck:web`.

- [R-SOLID-R-01] **`ChatActionsContext`** — Goal: stable `{reply, edit, delete, download, react, viewReactions, scrollTo, selectChat, sendQuickReply}` provided by ChatLayout. `MessageView` goes from 15 to about 7 props. `MessageItem`, `TemplateMessage`, `SystemMessageBubble` and the stubs use the context instead of props or `api.*`; Fixes: SOLID-R-10/25/34; Files owned: `context/ChatActionsContext.tsx` (new), `ChatLayout.tsx`, `MessageView.tsx`, `MessageItem.tsx`, `messages/{TemplateMessage,SystemMessage}.tsx`, `system-stubs/SystemStubRegistry.tsx`; Depends on: R-UICHAT-03 (stable callbacks). Must precede R-UICHAT-06; Lock: USEMSG. Can be folded into R-UICHAT-03 if that session has room. Risk: M; Safety net: MessageItem action tests (N-08), plus a render-count test showing that a presence tick re-renders 0 rows; Verify: vitest; the Profiler during a sidebar drag.
- [R-SOLID-R-02] **Message-kind descriptor table** — Goal: `components/chat/messages/messageKinds.tsx` with `classifyMessage(msg, raw)` and descriptors (Renderer, captioned, bubbleClass, isMedia, previewLabel, icon). `MessageItem`/`useParsedMessage`, `ChatList.getMessageIcon`, `messagePreview` and the plugin `message.isMedia` when-context all read it. Complete the `MessageType` union; Fixes: SOLID-R-11/12/20; Files owned: the new file, `message-item/useParsedMessage.ts`, `MediaMessages.tsx` (captions), `utils/messagePreview.ts`, `types/message.types.ts`, `ChatList.tsx` (1 function); Depends on: R-UICHAT-06 and R-SOLID-R-03. It touches ChatList, so it must land before or after R-UICHAT-08, not in parallel. Risk: M; Safety net: a table test of `classifyMessage` over fixtures for every kind, including ephemeral/viewOnce/template-with-image wrapping; snapshot the preview strings first; Verify: vitest; manually check the image/video/document captions.
- [R-SOLID-R-03] **Complete the SystemStub registry** — Goal: a `CALL_LOG` stub (no `as any`), exported `isSystemMessage`, a typed `StubRenderer({content, msg})`, and `NameChip` moved to CSS; Fixes: SOLID-R-13; Files owned: `messages/SystemMessage.tsx`, `system-stubs/SystemStubRegistry.tsx`, `MessageItem.tsx:202` (1 line), `styles/messages.css`; Depends on: H-01 (same line). ∥ everything else. Risk: L; Safety net: new tests covering all 27 stubs + call + unknown (none exist today); Verify: vitest.
- [R-SOLID-R-04] **Contribution menu host + slot decisions** — Goal: `useContributionMenu(slot, whenCtx, baseCtx)` with submenu support and a toast on failure, used by `MessageItem`, `ChatList` and `MessageInput` slash commands. `utils/whenContext.ts` builders. Each of the 6 unconsumed slots is either rendered by `<ContributionOutlet>` or rejected by manifest validation (owner decision; `message-renderer` would plug into R-SOLID-R-02); Fixes: SOLID-R-14/15; Files owned: `hooks/useContributionMenu.ts`, `utils/{contributionUtils,whenContext}.ts`, the call sites in `MessageItem`/`message-item/*`, `ChatList.tsx`, `MessageInput.tsx`; Depends on: R-UICHAT-06, R-UICHAT-08, R-SOLID-R-05. Coordinate with R-KRN-11 (`chat-badge`) and R-KRN-10 (manifest schema); Risk: M. `CONTRACT` if slots are rejected; Safety net: tests for `when` filtering, a submenu click and a failing execute for both slots; Verify: vitest; a sample plugin's chat and message actions.
- [R-SOLID-R-05] **Composer split** — Goal: `MessageInput` becomes a ≤200-line shell over `useComposerEditor`, `useSlashCommands`, `usePasteAttachments` and `<VoiceRecorderBar>`; Fixes: SOLID-R-04; Files owned: `MessageInput.tsx`, new `components/chat/composer/*`, `tests/components/chat/MessageInput.test.tsx`; Depends on: R-UICHAT-09 (same file). Risk: M (contentEditable caret); Safety net: tests for slash dispatch, paste of an image, Enter with and without the mention menu, voice send, and reply cancel; Verify: vitest; a manual composer pass.
- [R-SOLID-R-06] **ChatLayout container split** — Goal: `useActiveChat()` (one `{jid,name,pic}` state plus the `setActiveChat`/`onOpenChat`/navigationBus/`onChatUpdated`/`onExtensionFocus` subscriptions), `useSidePanels()`, `<ChatHeader>`, `<ChatMainStage>`; Fixes: SOLID-R-03/17; Files owned: `ChatLayout.tsx`, new `components/chat/layout/*`, `tests/components/chat/ChatLayout.test.tsx`; Depends on: R-UICHAT-05, the R-UIAPP-04 decision, R-SOLID-R-01. Lock: USEMSG. Risk: M; Safety net: ChatLayout tests for navigation-bus open, `onOpenChat`, header update and search jump (untested today per UICHAT §3); Verify: vitest; manual chat switching.
- [R-SOLID-R-07] **`useMessages` event reducer** — Goal: a pure `messageListReducer` (new/edit/delete/status/reaction/historyAppended/sendResult) with table tests. The hook becomes subscribe → dispatch, and paging lives in `useMessagePaging`. Drop the exported `setMessages`; Fixes: SOLID-R-05, and part of R-23; Files owned: `components/chat/hooks/{useMessages,messageListReducer,useMessagePaging}.ts`, and the tests; Depends on: R-UICHAT-02, R-UICHAT-03. Lock: USEMSG. Risk: M-H; This lengthens the critical chain. Schedule it before R-UICHAT-04 only if the chain has slack; otherwise run it after; Safety net: N-08 characterisation, and reducer tests for dedupe and ordering; Verify: vitest; a manual edit/react/delete in an open chat.
- [R-SOLID-R-08] **Context slicing** — Goal: a presence store with `usePresenceText(jid)`/`usePresenceLookup()` selectors; memoised toast actions split from the toast list; per-slot `useContributions` selectors. The public hook names are kept; Fixes: SOLID-R-26/27/28; Files owned: `context/{Presence,Toast,Contribution}Context.tsx`, `hooks/useContributions.ts`, the 1-line updates in `ChatList`/`ChatLayout`; Depends on: none (∥). Rebase conflicts with R-UICHAT-08 and R-SOLID-R-06 are import lines only. Risk: L; Safety net: render-count tests (a presence event re-renders only the matching row/header); Verify: vitest; the Profiler.
- [R-SOLID-R-09] **AI sidebar container + stream contract** — Goal: a `useAIChatResources()` hook (chats with refresh, tools, models, options). `useAIStream` returns `replaceMessages`/`appendMessage` instead of `setMessages`+`messagesRef`. `useMentionSession` owns its state and returns prop bags. `AIMessageBubble` gets `chatList` from the resources hook; Fixes: SOLID-R-07/23/30/31; Files owned: `components/ai/{AIChatSidebar,AISmartInput,AIMessageBubble}.tsx`, `components/ai/hooks/*`, `hooks/useMentionSession.ts`; Depends on: R-UIAPP-05, F-UA-2. Risk: M (30 ms drip, auto-save timer); Safety net: the R-UIAPP-05 characterisation tests, plus an error-path test showing that the ref and state agree; Verify: vitest; manually run a tool call while switching sessions.
- [R-SOLID-R-10] **`RendererApi` domain facets** — Goal: split the contract into 8 facet interfaces (intersection = `RendererApi`), facet selector hooks, and a per-facet mock builder. Decide on the 9 unused methods (for mute/pin: wire built-in ChatList menu items, or delete); Fixes: SOLID-R-29; Files owned: `src/shared/ipc/*` (types), `services/{IAPIService,api.service}.ts`, `tests/mocks/mockApiService.ts`; Depends on: C-03 (and C-04 for dead channels). Lock: PRELOAD. Risk: L (types only, unless methods are deleted: `CONTRACT`); Safety net: the contract-drift test (N-05); Verify: `npm run typecheck`; vitest.
- [R-SOLID-R-11] **Dismissable primitives** — Goal: `useOutsideClick`/`useDismissable` adopted at the 7 non-MessageItem sites; `useGiphy` behind a `GiphyClient` seam; Fixes: SOLID-R-35/36; Files owned: `hooks/{useDismissable,useGiphy}.ts`, `services/giphyClient.ts`, `AISmartInput`, `AISettingsModal`, `ContextMenu`, `SearchFiltersPanel`, `MessageInput` (1 effect); Depends on: R-UICHAT-03 (the hook's origin). The `MessageInput` line conflicts with R-SOLID-R-05, so land 11 first. Risk: L; Safety net: existing ContextMenu/SearchFilters tests plus new outside-click tests; Verify: vitest.
- [R-SOLID-R-12] **Picker + media-download split** — Goal: split `EmojiStickerGifPicker` into tabs plus `useFavoriteStickers` and `useRemoteMediaToTemp`, with a discriminated-union pack selection. Add `useMediaDownload` shared by Image/Sticker/Video; Fixes: SOLID-R-06/09; Files owned: `components/picker/*`, `messages/MediaMessages.tsx`; Depends on: none for the picker. The `MediaMessages` part must precede R-SOLID-R-02, which also touches it. Risk: L-M; Safety net: new picker tests (none exist) for the tab switch, favourite remove and GIF select; a MediaMessages expired/retry test; Verify: vitest; manual picker and sticker checks.

**Hotspot conflicts:**
- Serial on USEMSG: R-SOLID-R-01, 06 and 07 run in the chain R-UICHAT-03 → R-SOLID-R-01 → R-UICHAT-06 → R-SOLID-R-02 → (R-SOLID-R-07) → R-UICHAT-04, with R-SOLID-R-06 after R-UICHAT-05.
- SOLID-R-19 (quote scroll) must be folded into R-UICHAT-06 or R-UICHAT-04.
- `ChatList.tsx` is touched by R-UICHAT-08, R-SOLID-R-02, 04 and 08.
- `MessageInput.tsx` is touched by R-UICHAT-09, R-SOLID-R-11, 05 and 04, in that order.
- R-SOLID-R-10 holds PRELOAD and follows the C-chain.

## 7. Scorecard

| Principle | Severity | Summary |
|---|---|---|
| SRP | High | 17 modules > 250 LOC, 67 functions > 60 lines. MessageItem, ChatList, MessageInput, ChatLayout and useMessages/useChats each mix IPC subscriptions, state machines and rendering. Only MessageItem, ChatList and App have split units today. |
| OCP | Medium-High | A new message kind touches 6 files, because MESSAGE_REGISTRY is keyed by a closed if-chain. SystemStubRegistry is used consistently but bypassed for calls. Contribution execution is inlined 3×, and 6 of 15 contribution slots (incl. `message-renderer`) are unconsumed. |
| LSP | Medium | Quote-jump bypasses `onScrollToMessage` (breaks under virtualisation). Media renderers ignore `textContent`. useAIStream exports a setter and ref pair whose invariant the caller must keep (and already breaks). The mock returns non-JSON `content`, and the `MessageType` union makes exhaustive checks lie. |
| ISP | Medium-High | IAPIService has 102 methods, with 22/34 consumers using ≤3 and 9 unused. MessageView takes 15 props. The Presence, Toast and Contribution contexts re-render all consumers on any change. useMentionSession takes its caller's setters and DOM ref. |
| DIP | Low-Medium | Direct `window.api` is confined to the panels (already owned by R-UIAPP-02). The remaining issues: leaf components pull `useAPI()` for per-row IPC, useGiphy hits `fetch`/env directly, 8 hand-rolled document listeners, and main-process type imports (owned by R-UIAPP-09). |
