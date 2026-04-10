# WhatsApp Parity Roadmap: Remaining Features

This document tracks the features required to bring **smartChat** to complete feature parity with the official WhatsApp experience, categorized by functional area.

## 1. Core Messaging & Rich Media
- [x] **Voice Messages (PTT)**
  - [x] Support recording `.ogg` files in the `MessageInput`.
  - [x] Render playback with audio waveforms in `MessageItem`.
  - [x] Support "1x/1.5x/2x" playback speeds.
- [ ] **Stickers & GIFs**
  - [ ] Sticker picker integration.
  - [ ] Giphy/Tenor API integration for GIF search and sending.
- [ ] **Message Lifecycle**
  - [ ] **Edit Messages**: Support for editing sent messages (IPC + UI).
  - [ ] **Message Revocation**: "Delete for Everyone" and "Delete for Me" logic.
  - [ ] **Read Receipts**: Visual update for Blue Ticks sync.
- [ ] **Starred Messages**
  - [ ] Capability to "Star" messages.
  - [ ] A dedicated "Starred Messages" view.
- [ ] **Rich Content**
  - [ ] **Location Sharing**: Rendering static/live locations via maps.
  - [ ] **Contact Cards**: Sending and rendering VCards (Contact Cards).
  - [ ] **Link Previews**: Rich metadata scraping for URLs in input.

## 2. Conversation & Group Management
- [ ] **Group Operations**
  - [ ] **Group Creation**: UI to pick multiple participants and set group info.
  - [ ] **Admin Tools**: Promote/Demote admins, remove participants.
  - [ ] **Group Settings**: Restrict info editing or messaging to admins.
  - [ ] **Join via Link**: Support for WhatsApp group invite links.
- [ ] **Communities & Channels**
  - [ ] Support for Community structures and announcement channels.
  - [ ] Support for Channels (Searching and following public broadcast feeds).
- [ ] **Chat Organization**
  - [ ] **Archive Folder**: Move chats to and from an archive section.
  - [ ] **Filters**: Top-level tabs for "All", "Unread", "Groups", "Favorites".
  - [ ] **Context Menu**: Right-click on chat list for Pin/Mute/Archive/Read.

## 3. UI/UX & Identity
- [ ] **Profile & Settings**
  - [ ] **Self Profile**: Edit own Profile Picture, Name, and "About" status.
  - [ ] **Privacy Settings**: Manage "Last Seen," "Profile Photo Visibility," and "Blocked Contacts."
  - [ ] **Chat Settings**: Per-chat wallpapers and notification toggles.
- [ ] **Rich Media Gallery**
  - [ ] "Media, Links, and Docs" view for each chat thread.
  - [ ] Full-screen media lightbox for images and videos with navigation.
- [ ] **Pickers**
  - [ ] Full Emoji picker in the message input area.
  - [ ] File selection UI refinement (drag and drop support).

## 4. System & Integration
- [ ] **Calling (Metadata)**
  - [ ] Display notifications for current/missed Voice and Video calls.
  - [ ] Integration with system-level call handlers.
- [ ] **Status (Stories)**
  - [ ] A dedicated UI section to view contact statuses.
  - [ ] Ability to post text or media statuses.
- [ ] **Notifications**
  - [ ] Native OS push notifications for new messages.
  - [ ] "Quick Reply" support from within the notification.
- [ ] **History Back-fill**
  - [ ] On-demand history fetch: Pull older messages from the phone when scrolling up.

## 5. Security & Trust
- [ ] **Encryption Indicators**
  - [ ] Display the "Messages and calls are end-to-end encrypted" banner.
  - [ ] Verify security codes view.
- [ ] **Two-Step Verification**
  - [ ] Integration with WA's 2SV (PIN) flow if required.

---
*Note: This list focuses strictly on matching standard WhatsApp features and does not include existing AI-enhanced features unique to smartChat.*
