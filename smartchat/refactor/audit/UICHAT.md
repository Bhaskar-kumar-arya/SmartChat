# UICHAT audit: renderer chat UI (chat/**, picker/**)

Scope read in full: `components/chat/**` (31 files, 6,450 LOC), `components/picker/EmojiStickerGifPicker.tsx`,
and, where call sites needed it, `hooks/useMentions.ts`, `hooks/useMultiFileQueue.ts`, `context/PresenceContext.tsx`,
and `main/services/messages/{MessageService,MessageQueryRepository}.ts` (pagination semantics).
Every path below is relative to `src/renderer/src/components/chat/` unless it says otherwise.
I checked bug-audit-frontend/TRACKER.md (F3–F7) and none of the items below appears there.

## 1. Bugs (confirmed)

- [B-UICHAT-01] **high** `hooks/useMessages.ts:66-86,115-129,136-139`: a jump loads an old window, and paging then puts newer messages on top of it.
  `performJump` replaces the list with `getMessagesAround` (target−20 … target+200, `MessageQueryRepository.ts:341-358`) and resets `currentPage=1`.
  The next `loadMore` asks for `getMessages(jid, 2, 50)`, which is OFFSET 50 counted from the **newest** message (`findChatMessagesWithSender`, ORDER BY timestamp DESC).
  Scenario: open a search result or quoted reply 1,000 messages back, then scroll up. Messages 51–100 from the newest get prepended *above* the old window, so the chronology is broken and the date separators are wrong.
  There is also no "load newer" path. Live messages are appended under target+200, which leaves a silent gap.
  Fix: after a jump, page with a timestamp or id cursor (`before=<oldest loaded id>`) instead of page numbers, and add `loadNewer` or a "jump to latest" action that reloads page 1.

- [B-UICHAT-02] **med** `hooks/useMessages.ts:309-347`: a send that resolves after a chat switch is appended to the new chat's list.
  `sendMessage`/`sendMediaMessage` add `sentMsg` to whatever list is current and never compare `sentMsg.chatJid` with `activeJidRef.current`.
  Scenario: send a video in chat A (the upload takes seconds) and click chat B. A's bubble appears at the bottom of B until B reloads.
  The same applies to `handleSendMultiMedia` (`ChatLayout.tsx:85-101`) and to GIF/sticker sends that finish after the picker closes.
  Fix: `if (!isSameJid(sentMsg.chatJid, activeJidRef.current)) return sentMsg` before `setMessages`.

- [B-UICHAT-03] **med** `ChatLayout.tsx:76,114-122` together with `hooks/useMultiFileQueue.ts`: staged attachments survive a chat switch and are sent to the new chat.
  `useMultiFileQueue` has no knowledge of the jid, and `handleSelectChat` never calls `clearQueue()`.
  The preview overlay is `position:absolute` inside `.chat-main` (`styles/attachment-preview.css:66`), so the chat list can still be clicked.
  Scenario: drop 5 private photos into chat A, click chat B, press Send. All 5 go to B.
  This is the multi-file counterpart of F6-01, which only guarded voice notes.
  Fix: call `clearQueue()` in `handleSelectChat` and `handleOpenExtensionChat`, or snapshot the jid when files are staged and refuse to send on a mismatch.

- [B-UICHAT-04] **med** `MessageInput.tsx:337-341` together with `hooks/useMentions.ts:62-72`: Enter does nothing whenever an `@` token is open, even in DMs or when nothing matches.
  `showMenu` becomes true for any `@` before the caret with no space after it. The DM check only empties `participants`, and `MentionMenu` then renders `null` (`MentionMenu.tsx:54`).
  `handleKeyDown` still blocks Enter because `showMenu` is true.
  Scenario: in a DM, type `mail me at bob@corp.com` and press Enter. Nothing is sent and no feedback is shown.
  Fix: block Enter only when the menu is actually visible, i.e. participants exist and the filtered list is non-empty. Lift `filtered` or expose `menuVisible` from `useMentions`.

- [B-UICHAT-05] **med** `ChatLayout.tsx:114-122` together with `hooks/useMessages.ts:90-104`: selecting a message search result **in the chat that is already open** never fetches the target.
  `ChatList` → `SearchResultsPanel` calls `onSelectChat(jid, name, undefined, messageId)` (`ChatList.tsx:401`), and `handleSelectChat` only runs `setTargetMessageId`.
  `useMessages` re-fetches only when `activeJid` changes (`lastActiveJid` guard), so a target that is not loaded is never loaded.
  `targetMessageId` then stays set, so `MessageView.tsx:102-106` keeps skipping auto-scroll-to-bottom for every new message, and `:125-146` logs a warning on every list change.
  Fix: in `handleSelectChat`, if `jid === activeJid && messageId`, route through `jumpToMessage`, as the navigation bus already does at `ChatLayout.tsx:177`. Clear the target if it is still not in the DOM after the jump.

- [B-UICHAT-06] **med** `MessageView.tsx:94-122`: an incoming message scrolls the user to the bottom even while they are reading history.
  `shouldScroll = isInitialRenderForChat || isNewMessage`, with no "was near the bottom" check.
  Scenario: scroll up 300 messages in an active group. Every new message scrolls smoothly to the bottom and the reading position is lost.
  Fix: auto-scroll only if `distanceFromBottom < ~150px` just before the update, or if `lastMsg.fromMe`. Otherwise show the "↓ Latest" pill with a counter.

- [B-UICHAT-07] **med** `hooks/useMessages.ts:115-129`, used from `MessageView.tsx:205-223`: `loadDbPage` returns `olderMsgs.length` and not the number of *fresh* rows.
  When a page consists entirely of messages already loaded, it returns 50 and the prepend is a no-op. `MessageView` then waits for a `[messages]` change that never comes, and only the 3 s safety timer releases the lock.
  Scenario: 50 or more live messages arrive while the chat is open, so page 2 overlaps completely and each scroll up stalls for 3 s.
  Fix: return `fresh.length`, computed outside the updater from `messagesRef`, and loop to the next page when it is 0 but `olderMsgs.length > 0`.

- [B-UICHAT-08] **low** `messages/TextMessage.tsx:117`: `remarkMath` with default options treats single `$` as inline math.
  Scenario: "it's $5 now and $10 later" renders `5 now and ` as italic KaTeX, and prices and shell snippets are mangled.
  Fix: `[remarkMath, { singleDollarTextMath: false }]`.

- [B-UICHAT-09] **low** `messages/TextMessage.tsx:54,69`: the mention preprocessor matches e-mail addresses and uses prefix lookups.
  `foo@bar.com` is split into `foo` + `[@bar.com](mention:…)`, which renders a green mention and loses GFM autolinking.
  `Object.keys(...).find(k => k.startsWith(rawContent))` maps `@1` to the first mention that starts with 1.
  Fix: require a word boundary before `@` (`(?<![\w.])@`), and require an exact or digits-only match.

- [B-UICHAT-10] **low** `MessageInput.tsx:225-274`, `MessageItem.tsx:355-373`: send, edit and delete failures produce unhandled rejections and no UI feedback.
  `useMessages.sendMessage/editMessage/deleteMessage` rethrow. `handleSend` is `try/finally` with no catch and is called un-awaited from `handleKeyDown`.
  `handleSaveEdit` and `handleConfirmDelete` also await without a catch, so a failed edit leaves the editor open with nothing logged in the UI.
  Fix: catch, and surface through `useToast().showError`, which `MessageView` already uses.

- [B-UICHAT-11] **low** `messages/MediaMessages.tsx:409`, `messages/AudioMessage.tsx:20`: the Document and Audio download buttons call `onDownload` directly.
  `onDownload` is `MessageItem.handleDownload`, which rethrows (`MessageItem.tsx:314-320`).
  An expired or failed download therefore becomes an unhandled rejection and shows no "Expired" state. Image, Sticker and Video wrap the call in try/catch.
  Fix: use the same `handleDownload` + `downloadFailed` pattern.

- [B-UICHAT-12] **low** `ChatLayout.tsx:64,127`: extension chats are fed to `useMessages` as `activeJid = "extension_<id>"`.
  This fires `api.markRead`, `api.getMessages` and `api.setActiveChat` against a synthetic JID on every open of an extension chat.
  It also subscribes four WhatsApp event listeners for a chat that cannot receive them.
  Fix: pass `isExtensionChat ? null : activeJid` to `useMessages`, and give the extension id its own state.

- [B-UICHAT-13] **low** `MessageItem.tsx:220`: `editText` is initialised once from `msg.textContent` and never reset.
  If you cancel an edit and reopen it, the discarded draft comes back. After a remote edit, the editor still shows the stale text.
  Fix: `setEditText(msg.textContent ?? '')` in the Edit menu handler.

- [B-UICHAT-14] **low** `ChatList.tsx:153-157`: in `confirmIndex`, the `api.clearVectors()` call has no try/catch.
  If it rejects, you get an unhandled rejection and indexing never starts, with no feedback.

**SUSPECT (unconfirmed)**
- `MessageItem.tsx:202-216`: an early `return` for system messages sits before ~15 hooks. This violates the Rules of Hooks, and React will throw if a message with the same key ever changes between system and non-system `messageType`. Today that looks unlikely.
- `hooks/useChats.ts:264-321`: an `onChatUpdated` for a chat whose `getChat()` is in flight from `handleNewMessage` sees `hasChat === true`, then takes the `idx === -1 → return prev` branch, and the update is dropped. The in-flight coalescing from F3-03 covers only new-message events.
- `hooks/useChats.ts` does not subscribe to `onMessageDeleted`. If main does not also emit `chat.updated` on delete, the sidebar preview keeps showing the deleted text. I did not verify this in main.
- `ChatLayout.tsx:196` compares `update.jid === activeJid` strictly. Everywhere else uses `isSameJid`, so the header name or avatar may not update when the JID arrives in a different form.
- `hooks/useMentions.ts:22-34`: `fetchParticipants` has no stale-response guard, so a fast A→B switch can show A's participants in B. This file is outside my slice.

## 2. Code quality / design issues (ranked)

1. **The `MessageItem` memo is defeated on every `ChatLayout` render.** `useMessages` returns `editMessage`, `deleteMessage` and `handleDownloadMedia` as new closures on every render (`useMessages.ts:202,349,361`).
   `ChatLayout` passes them straight through (`ChatLayout.tsx:342-345`), and `MessageView`'s `useCallback([onEdit])` wrappers therefore change every time (`MessageView.tsx:237-247`).
   `ChatLayout` re-renders on every presence event, since `usePresence` is context-wide, on every mousemove during a sidebar drag (`useSidebarResize.ts:34`), on every message/status event, and on header updates. Each one re-renders **every** `MessageItem`.
   Each `MessageItem` render does a `JSON.parse(msg.content)` + `unwrapMessage` (`:208`), `getThumbnailData` base64 re-encoding (`MediaMessages.tsx:268-281`), and a full ReactMarkdown + remark-gfm + remark-math + KaTeX pipeline (`TextMessage.tsx`), none of it memoised.
   Fix: `useCallback` all the returned mutators (use `activeJidRef` so they are stable), and `useMemo` the parse and the markdown output keyed on `msg.content` / `msg.textContent`.
2. **Unbounded, non-virtualised message list.** `MessageView.tsx:297` renders every loaded message. `messages` grows through prepend and append with no cap, so a long session in a busy group plus scroll-back means thousands of DOM rows.
   Per-row costs make it worse:
   - `MessageItem.tsx:238-242`: one `api.getMyJid()` IPC per mounted message.
   - `MessageItem.tsx:277-289`: one `document` `mousedown` listener per message, so N listeners each call two to three `setState`s on every click.
   - `MessageItem.tsx:200`: one `useContributions('message-action')` subscription per message.
   - `MediaMessages.tsx:204-211`: every sticker auto-downloads on mount.

   Scroll anchoring uses `useEffect` and not `useLayoutEffect` (`MessageView.tsx:149-166`), so a prepend visibly jumps for a frame.
   Fix: virtualise (react-virtuoso handles reverse lists and prepend anchoring), lift `myJid` into a context, and use one delegated outside-click handler.
3. **God components.**
   - `MessageItem.tsx` (713 LOC): parsing, type routing, reaction menu, dropdown positioning, edit mode, receipts modal, sticker favourites, plugin actions.
   - `ChatList.tsx` (637): list rendering, search, indexing progress, logout, settings/extension modals, context menu, per-row markup inline.
   - `MessageInput.tsx` (546), `EmojiStickerGifPicker.tsx` (447), `ChatLayout.tsx` (425), `useChats.ts` (419).
4. **Duplicated logic.**
   - The chat sort exists twice: `useChats.ts:12-26 sortChats` and `useChatHierarchy.ts:58-68`.
   - The ChatItem "last message" patch object is built three times: `useChats.ts:179-193`, `:197-211` and `:241-255`. It should be one `applyMessageToChat(chat, msg)`.
   - `highlightMatch` appears in `ChatSearchSidebar.tsx:99` and `SearchResultsPanel.tsx:70`; the second does not trim.
   - `setQuickRange` appears in `ChatSearchSidebar.tsx:73` and `SearchFiltersPanel.tsx:86`.
   - The download/expired state machine is copied three times in `MediaMessages.tsx` (Image, Sticker, Video).
   - The "send result upsert" is written twice (`useMessages.ts:313-321`, `:333-341`).
   - `getSenderColor` / JID-stripping (`split('@')[0].split(':')[0]`) is hand-rolled in `MessageItem.tsx:80-81,395` next to `isSameJid`.
5. **Two sources of truth for "has more."** `MessageView` keeps a local `hasMore` (`:52`), which is patched against the hook's `canLoadMore` through refs and effects (`:171-177`, `:218`). There are also two chat-switch reset heuristics (`:71-80` keyed on jid and `:83-92` keyed on firstId/length ≤ 50). Paging state should live only in `useMessages`.
6. **Magic sentinels and strings.** `loadMore` returns `-1` for "on-demand fetch started" (`useMessages.ts:162`).
   The extension prefixes are inconsistent: `extension_` in `ChatLayout.tsx:127` and `ChatList.tsx:425`, but `extension:` in `ChatLayout.tsx:150,184`.
   The `__button:` text sentinel is at `ExtensionChat/ExtensionChatView.tsx:31`.
   The `selectedPackIndex` values `-2`/`-1` (`EmojiStickerGifPicker.tsx:51`) should be a discriminated union.
7. **Leaky layering and bypasses.**
   - `ChatList.tsx:22` imports a type from `../../../../main/kernel/...`.
   - `TemplateMessage.tsx:181` calls `api.sendMessage` directly and bypasses `useMessages`, so there is no optimistic append or error surface.
   - `ExtensionChatView.tsx:31` calls `api.extensionChatSend` directly even though its header comment says "no direct api calls".
   - `MessageInput.tsx:167` and `utils/editorUtils.ts:52` hot-link emoji PNGs from cdn.jsdelivr.net, a runtime network dependency and a privacy leak.
8. **Prop drilling.** `ChatLayout` → `MessageView` → `MessageItem` threads eight callbacks (`onReply/onEdit/onDelete/onDownloadMedia/onViewReactions/onScrollToMessage/onSelectChat` plus the targets). `onSelectChat` also goes on to `SystemMessageBubble` and the stub registry. A `ChatActionsContext` holding stable callbacks would remove both the drilling and the memo breakage.
9. **Typing.**
   - 13 `any` in scope: picker 5, `MessageItem` 2 (`unwrapMessage(msg: any)`, `ctx?: any`), `ChatList` 2 (`(chat as any).source`), `MessageView` 2 (`Promise<any>` props), `TextMessage` 1, `SystemMessage` 1.
   - Plus 5 `as ChatItem` casts in `useChats`.
   - `MessageView` declares `onEdit: ... => Promise<any>` while `MessageItem` expects `Promise<void>`.
10. **Leftover debug logging.** `MessageInput.tsx:235,238,245` has `console.log` on every slash command.
11. **CSS, high level.** Top-level selectors are repeated within single files: sidebar.css 52, messages.css 31, picker.css 19, input.css 6.
    Unreferenced class names: input.css 12 of 33, picker.css 13 of 46, sidebar.css 11 of 147, chat-main.css 1 of 10.
    `.date-separator` and `.dropdown-menu`/`.dropdown-item` are defined in both `messages.css` and `shared.css`. `.date-separator` is also reused for the "to" span in the search date pickers (`ChatSearchSidebar.tsx:166`, `SearchFiltersPanel.tsx:188`), so the day-divider styles leak into those forms.
    Inline `style={{}}` objects are scattered through `ChatList`, `ChatLayout` and the picker (`EmojiStickerGifPicker.tsx:329-348` needs `!important` in CSS to override an inline `opacity:0`).

## 3. Test quality

**No tests at all:** `EmojiStickerGifPicker.tsx`, of which only the pure `toWebpStickerUrl` helper is tested; `SidebarRail.tsx`; `messages/system-stubs/SystemStubRegistry.tsx` (268 LOC, with one stub exercised indirectly); `ExtensionChat/ExtensionMessageRenderer` card/button paths; and ChatLayout's navigation-bus, search-jump and multi-file send flows.

**Tests that pass even when the code is broken:**
- `tests/components/chat/MessageView.test.tsx:108-120` (F5-07 regression) and `:121-130` query `.reactions-display` / `.reaction-chip`. `ReactionsDisplay` renders `.message-reactions`, so `badge` is null and both tests assert nothing: one behind `if (badge)`, the other with an equality that is trivially true. The F5-07 fix is therefore unprotected.
  The same test also mutates the shared `dummyMessages[1].reactions` fixture (shared mutable state between tests).
- `MessageInput.test.tsx:72-73` (F6-01): `if (sendVoiceBtn) await user.click(...)` passes vacuously if the button is missing.
- `MessageView.test.tsx:67-79`: only checks that `scrollIntoView` was called at all. It is also called by the bottom-scroll path, and the test does not check `.msg-highlighted` or `onTargetScrolled`.

**Thin coverage of hot logic:**
- `MessageItem.tsx`: 713 LOC with one test, reaction toggle only. Edit, delete, download, the system-message branch, plugin actions and quote click are all untested.
- `useMessages.test.tsx`: nothing covers reaction merge (`handleReactionUpdate`), `onWaHistoryAppended` / the `-1` sentinel / the 40 s timeout, `jumpToMessage` short-circuit, edit, delete or status events, `handleDownloadMedia`, send racing a chat switch (B-02), or loadMore after a jump (B-01).
- `useChats.test.tsx`: `onChatUpdated`, `onMessageEdited`, `onMessageStatusUpdated` with the pending-status cache, pagination (`loadMore`/`hasMore`) and F3-03 coalescing are all untested.
- `ChatLayout.test.tsx` covers render and toggles only.

**Flaky or slow patterns:** real `setTimeout(r, 50)` sleeps appear 5× in `ChatLayout.test.tsx` and 8× in `ChatList.test.tsx`. They should use `waitFor` or fake timers.

**Duplicated helpers:** 13 hand-rolled `createWrapper = (api) => <APIProvider …>` wrappers across `tests/hooks/*`, even though `testUtils.renderWithProviders` exists.
The full event-subscription mock block (`onNewMessage/onMessageEdited/onMessageDeleted/onMessageStatusUpdated/onChatUpdated`) is copy-pasted 3× in `useMessages.test.tsx` and 3× in `useChats.test.tsx`. `createMockApiService` should return controllable emitters (`api.emit.newMessage(msg)`).
`MessageItem` fixtures are redefined in each file; a shared `makeMessage(overrides)` / `makeChat(overrides)` factory is needed.

## 4. Refactor proposal

**Hotspots:** `ChatLayout.tsx`, `hooks/useMessages.ts` and `MessageView.tsx`. Most units touch at least one of them, so R-01 → R-02 → R-03 must run serially. R-05 to R-09 can run in parallel with those.

- [R-UICHAT-01] **Test harness: controllable API event emitters and fixtures.** Goal: `createMockApiService` exposes `emit.*` for every `on*` subscription, plus `makeMessage` / `makeChat` factories. Fix the two vacuous `MessageView` reaction tests and the `if (btn)` guard in the `MessageInput` test.
  Files: `src/renderer/tests/mocks/mockApiService.ts`, `src/renderer/tests/testUtils.tsx`, `tests/components/chat/MessageView.test.tsx`, `tests/components/chat/MessageInput.test.tsx`.
  Depends: none. Risk: low. Safety net: n/a. Verify: `npx vitest run src/renderer/tests`. The fixed tests must fail when the F5-07 fix is reverted.
- [R-UICHAT-02] **Characterise, then fix, the `useMessages` pagination model (B-01, B-02, B-07).** Goal: replace page numbers with a `before` cursor (oldest loaded id/timestamp), add `hasNewer` + `loadNewer` after a jump, return the fresh count, and guard send appends by `chatJid`.
  Files: `components/chat/hooks/useMessages.ts`, `tests/hooks/useMessages.test.tsx`. Main or preload is only needed if a cursor API is added.
  Depends: R-01. Risk: **high**, because the on-demand WhatsApp history retry depends on page numbers. Safety net: first write characterisation tests for the loadMore → -1 → `onWaHistoryAppended` → retry flow, the jump window, and the dedupe.
  **CONTRACT-CHANGE** if `messages:get` gains a `beforeId`/`afterId` parameter (IPC plus preload plus `APIService`). A renderer-only alternative is to compute the page offset from the loaded count; this is imperfect, but no contract change.
  Verify: vitest; manually, jump to an old search hit, then scroll up and down and check ordering and the gap.
- [R-UICHAT-03] **Stabilise the `MessageItem` render path.** Goal: `useCallback` every mutator returned by `useMessages` (via refs); remove the wrapper callbacks in `MessageView`; `useMemo` the content parse in `MessageItem` and the markdown output in `TextMessage`; lift `getMyJid` into a `SelfJidContext`; replace the per-row document listener with a single outside-click hook.
  Files: `hooks/useMessages.ts`, `MessageView.tsx`, `MessageItem.tsx`, `messages/TextMessage.tsx`, new `src/renderer/src/context/SelfJidContext.tsx`.
  Depends: R-02, since it shares `useMessages.ts`. Risk: med, because stale refs are possible. Safety net: a render-count test in which a presence update re-renders 0 `MessageItem`s (use a `vi.fn` inside a mocked `TextMessage`).
  Verify: vitest; React Profiler during a sidebar drag.
- [R-UICHAT-04] **Virtualise `MessageView` and move all paging state into the hook.** Goal: react-virtuoso or an equivalent, with `firstItemIndex` prepend anchoring and `followOutput` only when at the bottom (B-06). Delete the local `hasMore`, the two reset heuristics and the `pendingHistoryPrepend` ref.
  Files: `MessageView.tsx`, `styles/messages.css`, `tests/components/chat/MessageView.test.tsx`.
  Depends: R-02, R-03. Risk: **high** (scroll UX, jsdom cannot measure layout). Safety net: characterisation tests for target highlight, jump-to-latest and load-older calls. A manual QA script is required.
  Verify: vitest plus a manual pass on a chat with 5,000+ messages.
- [R-UICHAT-05] **Chat-switch hygiene in `ChatLayout` (B-03, B-05, B-12).** Goal: clear the staged-file queue on switch; route same-chat `messageId` selection through `jumpToMessage`; stop feeding `extension_*` into `useMessages`; unify the `extension_`/`extension:` prefix constant.
  Files: `ChatLayout.tsx`, `ChatList.tsx`, `tests/components/chat/ChatLayout.test.tsx`.
  Depends: R-01. Risk: low to med. Safety net: new ChatLayout tests for switch-with-staged-files and search-hit-in-the-open-chat. Verify: vitest.
- [R-UICHAT-06] **Split `MessageItem`.** Goal: extract `useParsedMessage(msg)` (unwrap, ctx, type key, localURI), `<MessageQuote>`, `<ReactionMenu>`, `<MessageActionsMenu>` (dropdown + plugin actions + sticker favourite), and `<MessageEditor>` (fixes B-13). Hoist hooks above the system-message return.
  Files: `MessageItem.tsx` plus new `components/chat/message-item/*`.
  Depends: R-03. Risk: med. Safety net: expand `MessageItem.test.tsx` first to cover edit, delete, reply, download, quote click and a plugin action. Verify: vitest.
- [R-UICHAT-07] **Deduplicate the `useChats` / hierarchy logic.** Goal: one `compareChats` shared by `useChats` and `useChatHierarchy`; one `applyMessageToChat`; route `onChatUpdated` through the in-flight coalescing (SUSPECT).
  Files: `hooks/useChats.ts`, `hooks/useChatHierarchy.ts`, new `components/chat/hooks/chatListOps.ts`, `tests/hooks/useChats.test.tsx`.
  Depends: R-01. Risk: med. Safety net: tests for `onChatUpdated`, edit, status and pagination. Verify: vitest.
- [R-UICHAT-08] **Split `ChatList` and memoise its rows.** Goal: extract a `<ChatListRow>` memo component, an `IndexingControls` hook+component (progress, clearVectors with catch, B-14), and a `<ChatListModals>` component. Replace `(chat as any).source` with a typed discriminant.
  Files: `ChatList.tsx`, new `components/chat/chat-list/*`, `tests/components/chat/ChatList.test.tsx`.
  Depends: R-07 is optional. Risk: low to med. Safety net: existing ChatList tests with the sleeps converted to `waitFor`. Verify: vitest.
- [R-UICHAT-09] **Composer and text rendering fixes (B-04, B-08, B-09, B-10, B-11).** Goal: gate Enter on an actually visible mention menu; set `singleDollarTextMath:false`; add a word boundary to the mention regex; show send/edit/delete/download failures through toasts; remove debug `console.log`s.
  Files: `MessageInput.tsx`, `src/renderer/src/hooks/useMentions.ts`, `messages/TextMessage.tsx`, `messages/MediaMessages.tsx`, `messages/AudioMessage.tsx`, and the matching tests.
  Depends: none. Risk: low. Safety net: new TextMessage cases for `$5 … $10`, an e-mail address and `@1`, plus a MessageInput case for Enter with an `@` in a DM. Verify: vitest.
- [R-UICHAT-10] **Shared search utilities and CSS cleanup.** Goal: extract `highlightMatch` + `quickRange` into `utils/`; rename the date-picker "to" span class; remove unreferenced and duplicate selectors in input.css, picker.css and sidebar.css.
  Files: `ChatSearchSidebar.tsx`, `SearchResultsPanel.tsx`, `SearchFiltersPanel.tsx`, `styles/{input,picker,sidebar,messages,shared}.css`.
  Depends: none. Risk: low (visual). Safety net: existing search tests plus before/after screenshots. Verify: vitest; `npm run dev` visual check.

## 5. Top 5
1. **A jump breaks paging (high).** After jumping to an old message, scrolling up prepends the *newest* messages above the old window: `useMessages` pages by an offset from newest, and there is no load-newer path (B-01).
2. **Stale sends land in the wrong chat.** A send that resolves after a chat switch is appended to the new chat's list (B-02). Staged multi-file attachments are sent to whichever chat is open when Send is pressed (B-03).
3. **The `MessageItem` memo never holds.** `useMessages` returns unstable mutators, so every presence event, sidebar-drag mousemove or status update re-renders every message, each with its JSON parse and KaTeX markdown. The list is also unbounded and not virtualised, with one IPC call and one document listener per row.
4. **Composer and scroll problems.** Enter is silently swallowed whenever an `@` token is open, even in DMs and after e-mail addresses (B-04). Incoming messages yank a user who is reading history back to the bottom (B-06). A search hit in the chat that is already open is never fetched and disables auto-scroll (B-05).
5. **Tests don't guard the hot paths.** Two MessageView reaction tests, including the F5-07 regression test, assert nothing because the selector is wrong. `MessageItem` (713 LOC) has one test, and `useMessages` has no tests for reactions, on-demand history or jump-then-paginate. Fix the harness first (R-01), then make the pagination change (R-02, high risk; a cursor would change the `messages:get` IPC contract).
