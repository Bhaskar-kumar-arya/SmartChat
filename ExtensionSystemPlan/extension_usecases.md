# SmartChat Extensions — Real-World Use Cases

The power of the SmartChat extension system is that it runs *locally* inside a desktop app that already has direct access to WhatsApp. This unlocks use cases that traditional cloud-based WhatsApp bots either cannot do (due to API restrictions) or struggle with (due to privacy concerns and server costs).

Here are 15 real-world use cases categorized by how they utilize the extension system.

---

## Category 1: AI Superchargers (Tool Providers)
*These extensions primarily declare `tools:register` to give the built-in AI agent new superpowers. They run silently in the background until the AI calls them.*

**1. The "Second Brain" Connector (Notion / Obsidian / Roam)**
*   **What it does:** Allows the AI to search your personal notes or save new information to your knowledge base.
*   **How it works:** Bundles the `@notionhq/client` npm package. Registers tools like `searchNotes` and `createNote`.
*   **Example Prompt:** *"Summarize the messages from Alice today and save them to my Notion 'Meeting Notes' page."*

**2. Calendar & Meeting Assistant (Google / Outlook)**
*   **What it does:** Lets the AI check your availability and schedule meetings directly from chat context.
*   **How it works:** Bundles the `googleapis` package. Registers `checkAvailability` and `createEvent`.
*   **Example Prompt:** *"Find a 30-minute slot tomorrow that works for me, and tell Bob."*

**3. The Web Researcher (Playwright)**
*   **What it does:** Gives the AI the ability to actually browse the web, bypass JavaScript-heavy pages, and read articles.
*   **How it works:** Bundles `playwright-core`. Registers a `browseWeb(url)` tool that opens a headless browser, extracts text, and returns it to the AI.
*   **Example Prompt:** *"Read this article link John just sent and give me a 3-bullet summary."*

**4. GitHub / GitLab Integration**
*   **What it does:** Allows the AI to check CI/CD statuses, read pull requests, or create issues based on chat complaints.
*   **How it works:** Registers `getPullRequest`, `createIssue`. 
*   **Example Prompt:** *"Create a bug report on GitHub based on the crash log Mike just pasted in the Dev group."*

---

## Category 2: Background Automations
*These extensions act like autonomous agents. They declare `events:message:incoming` or `scheduler` to do things without the user lifting a finger.*

**5. The Intelligent "Out of Office" / Auto-Responder**
*   **What it does:** Replies to messages when you are asleep or in deep work, but only for certain people or urgent topics.
*   **How it works:** Listens to `message:incoming`. Uses `ctx.tools.call('sendMessage')` to reply. Uses `ctx.storage` to track who it has already replied to today to avoid spamming them.

**6. Automated Attendance / Form Filler (e.g., CodeTantra)**
*   **What it does:** Waits for a specific event (like a time of day or a specific link in a group chat) and automatically navigates a web portal to submit attendance.
*   **How it works:** Uses `ctx.scheduler` or `message:incoming`. Uses bundled `playwright` to navigate the external site, and `ctx.ui.notify` to tell the user it succeeded.

**7. Smart Message Forwarding / Bridging**
*   **What it does:** Forwards important messages from a noisy WhatsApp group to a Slack channel, Discord, or an email address.
*   **How it works:** Listens to `message:incoming`. Checks if the message matches criteria (e.g., contains "@everyone" or is from the boss). Uses bundled `axios` to post to a Slack Webhook.

**8. The Spam / Phishing Shield**
*   **What it does:** Automatically archives chats or deletes messages that look like spam, scams, or contain known phishing links.
*   **How it works:** Listens to `message:incoming`. Checks links against a bundled blocklist or an external API. Uses `ctx.tools.call('chatAction', { action: 'archive' })`.

**9. Media Auto-Archiver**
*   **What it does:** Automatically saves all images/documents sent by family members to a local folder or Google Drive.
*   **How it works:** Listens to `message:incoming`. If it has media, downloads it using the raw Baileys connection (if we expose media download eventually) or an external API, then writes to disk via bundled `fs`.

---

## Category 3: Dedicated Local Bots
*These extensions declare `ui:dedicated_chat` to provide a private, interactive CLI/bot experience right inside the SmartChat sidebar. No WhatsApp messages are actually sent.*

**10. Local Task Manager & Reminder Bot**
*   **What it does:** A bot you can talk to in order to manage your to-dos.
*   **How it works:** You type `/remind me in 10m to call mom` in the dedicated chat. The extension parses this, uses `ctx.scheduler.setTimeout`, and when it fires, uses `ctx.ui.notify` and `ctx.dedicatedChat.send` to alert you.

**11. Private Local CRM / Note Taker**
*   **What it does:** Allows you to tag contacts and add private notes that don't sync to WhatsApp.
*   **How it works:** You type `/note 91xxxxxxxxx@s.whatsapp.net Owes me $50`. The extension saves this to `ctx.storage`. Later, it can inject this context into the AI agent via a tool, so the AI knows this context.

**12. Code Snippet Vault / Scratchpad**
*   **What it does:** A place to dump text, links, or code snippets quickly.
*   **How it works:** Just paste stuff into the dedicated chat. The extension saves it locally. You can search it later with `/search regex`.

**13. Language Practice Partner**
*   **What it does:** A safe, local bot to practice Spanish (or any language) with.
*   **How it works:** Dedicated chat UI. Uses a bundled `openai` SDK to talk to an LLM configured strictly as a language tutor.

---

## Category 4: Analytics & Insights
*These extensions use the `ctx.db` query capabilities or event listening to generate data.*

**14. "WhatsApp Wrapped" / Stats Generator**
*   **What it does:** Generates cool statistics about your chatting habits (most used emojis, who talks the most in a group, peak activity hours).
*   **How it works:** Uses `ctx.tools.call('queryDb')` to run complex SQL aggregations. Presents the results in the Dedicated Chat UI using Rich Cards.

**15. Sentiment & Mood Tracker**
*   **What it does:** Tracks the overall "mood" of your conversations over time.
*   **How it works:** Periodically queries recent messages, runs them through a local lightweight sentiment analysis library (bundled via npm), and saves the daily mood score to `ctx.storage`. 

---

## Why this Architecture Wins
Because extensions are **trusted Node.js modules** that run locally:
1. **Zero Latency/Cost for Data:** Querying the SQLite DB for 50,000 messages takes milliseconds and costs $0. A cloud bot would have to download all that data via an API.
2. **Absolute Privacy:** The "Spam Shield" or "Notion Connector" runs entirely on the user's laptop. Personal WhatsApp messages are never sent to a random third-party developer's server.
3. **Unrestricted Network:** By bringing their own npm packages (`axios`, `playwright`), extensions can talk to *any* API (Notion, Google, internal company servers) without SmartChat needing to build specific integrations for them.
