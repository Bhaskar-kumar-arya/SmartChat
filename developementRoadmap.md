

### Phase 1: The Foundation & Authentication --> Completed

The goal of this phase is to get the application booting, communicating across the IPC bridge, and successfully pairing with your phone.

1. **Scaffold the Monorepo:** Set up an Electron project configured with TypeScript. Configure the strict multi-process boundary: a Node.js Main Process for backend logic and a React Renderer Process for the UI, connected via a secure `contextBridge` (`preload.ts`).
2. **Initialize SQLite & Prisma:** Set up `schema.prisma`. Define your first table: the `AuthState` table. Since we are dropping multi-account support, this table only needs an `id` (the key identifier) and the `data` (the serialized cryptographic payload).
3. **Wire the Custom Auth State:** Write the Main Process logic to intercept Baileys' `creds.update` event and write the keys directly to your SQLite `AuthState` table using Prisma transactions.
4. **Build the Pairing UI:** * Implement the Baileys `connection.update` listener in the Main Process to catch the raw QR code string.
* Send this string via IPC to your React frontend.
* Render it using a library like `qrcode.react`.
* (Optional) Implement the fallback Pairing Code (8-character string) input form.



### Phase 2: Core Data Ingestion (The "Big Sync")

Once authenticated, WhatsApp will dump the historical data. The goal here is to catch it without crashing the V8 engine.

1. **Expand the Prisma Schema:** Create the `Contact`, `Chat`, and `Message` tables. Focus strictly on text and metadata for now (JID, sender, timestamp, raw text content).
2. **Handle `messaging-history.set`:** Intercept the initial sync event in the Main Process.
3. **Batch Insertion:** Write the logic to parse the dense payload and stream it into SQLite using `prisma.$transaction`.
4. **UI Loading State:** Send an IPC event with the `progress` percentage to the React frontend to display a loading screen while the database populates.

### Phase 3: The MVP Shell & Real-Time Text

This phase brings the app to life. You'll build the UI and establish two-way text communication.

1. **Build the React Layout:** Create the basic UI shell—a sidebar for the chat list and a main window for the active conversation.
2. **Read from SQLite (Pagination):** Create IPC handlers so the React frontend can request the chat list (sorted by latest timestamp) and the last 50 messages of a clicked chat. Never load the whole database into React.
3. **Handle Incoming Messages (`messages.upsert`):**
* Listen for `type: "notify"`.
* Insert the new message into SQLite.
* Fire an IPC event to update the active React chat window if the user is currently viewing that thread.


4. **Handle Outbound Messages:**
* Create a text input component in React.
* Send the text and target JID via IPC to the Main Process.
* Execute `sock.sendMessage()` and await the server response before updating the local UI.



### Phase 4: Identity & Context Polish

Now that text is flowing, it's time to make the raw data look like a proper chat application.

1. **Implement LID Mapping:** Integrate the `lid-mapping.update` listener. Update your `Contact` table to resolve cryptic Local Identifiers (LIDs) back to standard Phone Numbers and display names.
2. **Profile Names & Group Names:** Update the React sidebar to fetch and display the actual `pushName` or group subject instead of raw JIDs.
3. **Unread Counters:** Track unread messages in the `Chat` table. Display the badge in the React sidebar.


### Phase 5: Media & Advanced Real-Time Features

With text rock-solid, introduce the heavy payloads and transient UI states.

1. **Register Custom Protocol:** In the Electron Main Process, register a custom protocol (e.g., `app://`) that maps to a secure local folder on your OS (e.g., `~/.config/YourApp/media/`).
2. **Inbound Image Decryption:** * Detect `imageMessage` in `messages.upsert`.
* Download and decrypt using `downloadContentFromMessage`.
* Save the buffer to your local media folder.
* Send the local file path to React to render as `<img src="app://media/filename.jpg" />`.


3. **Outbound Media Transmission:** Add a file picker to React, send the file path to Node.js, read it into a buffer, and send it via Baileys.
4. **Contextual Text:** Add support for rendering quoted replies (`message.extendedTextMessage`) and parsing link previews.
5. **Presence Indicators:** Hook up `presence.update` to show "Typing..." or "Online" in the React UI header.
6. **Basic Read Receipts:** When a user clicks a chat in React, trigger an IPC call to execute `sock.readMessages([keys])` to clear the unread badge and send the blue ticks to the sender.

### Phase 6: System Resilience

The final phase hardens the application against real-world network conditions.

1. **Automated Reconnection:** Implement the `lastDisconnect` logic with exponential backoff to handle Wi-Fi drops.
2. **Teardown on Logout:** Detect `DisconnectReason.loggedOut` to automatically wipe the Prisma database and return the user to the QR code screen.
3. **On-Demand History:** Implement an intersection observer in React. When the user scrolls to the top of the chat, fire an IPC event to fetch older messages from SQLite. If SQLite is empty for that range, invoke `sock.fetchMessageHistory()` to pull it from the phone.

