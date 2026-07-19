# SmartChat Extension — Feature Reference

**SmartChat** is a desktop chat application built around a WhatsApp engine, augmented with local AI capabilities. The **SmartChat Extension System** allows third-party developers to write Node.js modules that plug directly into this environment. 

Instead of building external bots that rely on webhooks and network servers, extensions run *locally* inside the app. They can act as background automations, provide new tools for the built-in AI, or act as standalone "local bots" with their own dedicated chat UI.

> What an extension can actually **do**. No architecture, no internals.

---

## 1  Listen to Events

Extensions can subscribe to real-time events happening inside SmartChat.

| Event | When it fires |
|---|---|
| `message:incoming` | A new WhatsApp message arrives in any chat |
| `message:deleted` | A message is revoked/deleted by the sender |
| `message:edited` | A message is edited |
| `message:status-updated` | A message is delivered, read, etc. |
| `reaction:processed` | Someone reacts to a message |
| `chat:created` | A new chat appears |
| `chat:archived` | A chat is archived |
| `chat:pinned` | A chat is pinned/unpinned |
| `contact:updated` | A contact's name or profile changes |
| `group:participant-added` | Someone joins a group |
| `group:participant-removed` | Someone leaves/is removed from a group |
| `group:subject-changed` | A group's name changes |
| `connection:open` | WhatsApp connects successfully |
| `connection:close` | WhatsApp disconnects |

Each event carries the relevant data (chat JID, sender, message content, timestamps, etc.).

---

## 2  Send WhatsApp Messages

Extensions can send messages to any WhatsApp chat on behalf of the user.

- **Text** — plain text or with formatting
- **Image** — from a base64 string, with optional caption
- **Document** — any file, with filename and mimetype
- **Audio** — voice note or audio file
- **Poll** — question with multiple options
- **Location** — latitude/longitude with optional place name
- **React** — add an emoji reaction to any message
- **Star / Unstar** — star or unstar a message

---

## 3  Dedicated Chat (Built-in Bot UI)

Each extension can have its own **private chat in the sidebar** — like a local bot the user can talk to. No real WhatsApp message is sent; it's a local conversation.

- **Send messages** into the dedicated chat as the "bot" side
- **Receive messages** the user types into the dedicated chat
- Supports rich content:
  - Plain text
  - Images
  - Documents
  - **Cards** — a title + body block (for structured replies)
  - **Buttons** — quick-tap action buttons inside a card
- **Slash commands** — register commands like `/list`, `/remind`, `/status` that appear as autocomplete suggestions when the user types `/`
- **Get history** — read the conversation history of the dedicated chat
- **Clear history** — wipe the conversation log
- **Focus** — programmatically open the dedicated chat in the UI

---

## 4  Persistent Storage

Each extension gets its own isolated key-value store that persists across app restarts.

- `get(key)` — read a value
- `set(key, value)` — write any JSON-serialisable value
- `delete(key)` — remove a key
- `clear()` — wipe all stored data for this extension
- `keys()` — list all stored keys

Values survive app restarts and extension reloads.

---

## 5  Register AI Tools

Extensions can add new tools to the AI agent. Once registered, the tool appears in the AI's tool list and the AI can call it automatically during a conversation — exactly like the built-in tools (`readMessages`, `queryDb`, `messageAction`, etc.).

Each tool has:
- A **name** and **description** (used by the AI to decide when to call it)
- A **JSON Schema** for its parameters
- An **execute function** that runs when the AI calls it

Example tools an extension could add:
- `getWeather` — fetches weather for a city
- `searchNotion` — queries a Notion database
- `getCalendarEvents` — reads Google Calendar
- `submitAttendance` — marks attendance on an external system

---

## 6  Call Built-in AI Tools

Extensions can call the existing AI tools directly without going through the AI agent. This is how an extension reads messages or queries the database — there is no separate API for those; the tools are the API.

- `readMessages` — fetch and format message history from any chat
- `queryDb` — run read-only SQL against SmartChat's SQLite database
- `sendMessage` — send a WhatsApp message
- `messageAction` — star, delete, or forward a message
- `chatAction` — archive, pin, or mute a chat
- `executeScript` — run a script in the AI's sandbox

---

## 7  Contacts & Chats

### Contacts
- Resolve a WhatsApp JID to a display name
- Search contacts by name or phone number
- Get your own JID (who you are logged in as)

### Chats
- List all chats (most recent first)
- Archive a chat
- Pin or unpin a chat
- Mute a chat (temporarily or permanently)

---

## 8  Scheduler

Extensions can run code on a schedule without user interaction.

- **Fixed interval** — run every N milliseconds (e.g. every 5 minutes)
- **One-shot delay** — run once after N milliseconds
- **Cron expression** — run at a specific time pattern (e.g. `0 9 * * *` = every day at 9 AM)

All scheduled tasks are automatically cancelled when the extension is disabled or the app quits.

---

## 9  Notifications & UI

- **OS notification** — show a native system notification (with optional click action to open a chat)
- **Toast banner** — show a temporary in-app message (info / success / warning / error)
- **Settings form** — show a configuration UI for the extension, defined as a JSON Schema; the user fills it in and the values are returned to the extension

---

## 10  Lifecycle Hooks

- **`onActivate`** — runs once when the extension loads; use for setup, loading saved state, connecting to external services
- **`onDeactivate`** — runs before the extension is unloaded or the app quits; use for cleanup, saving state, closing connections

---

## 11  Bring Your Own Dependencies

Extensions are full Node.js programs. They can use **any pure-JS npm package** bundled with them:

- `ws` — WebSocket client/server
- `axios` / `node-fetch` — HTTP requests
- `playwright` — browser automation
- `node-cron` — cron scheduling (alternative to `ctx.scheduler`)
- `cheerio` — HTML parsing
- `sharp` — image processing
- `openai` — call OpenAI or any other AI API directly
- …anything else on npm, as long as it doesn't require compiled native addons

---

## Summary

| Capability | What you can do |
|---|---|
| **Events** | Listen to 15+ real-time WhatsApp events |
| **Send** | Text, image, document, audio, poll, location, reaction |
| **Dedicated Chat** | Private bot chat with cards, buttons, slash commands |
| **Storage** | Persistent key-value store, isolated per extension |
| **Built-in Tools** | `readMessages`, `queryDb`, `sendMessage`, `messageAction`, `chatAction` |
| **AI Tools** | Register new tools the AI can call automatically |
| **Contacts & Chats** | Resolve names, list/archive/pin/mute chats |
| **Scheduler** | Intervals, timeouts, cron jobs |
| **UI** | OS notifications, toast banners, settings form |
| **npm** | Use any pure-JS npm package you bundle |
