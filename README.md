# SmartChat

SmartChat is a modern desktop chat client that brings WhatsApp Web into an Electron application powered by an intelligent AI workspace. 

Unlike traditional chat clients, SmartChat bridges WhatsApp messaging with multi-provider LLMs (Gemini, OpenAI, Groq, DeepSeek, LM Studio), on-device vector search, an extensible plugin ecosystem, local HTTP automation APIs, and conversation disentanglement capabilities.Also, this is not yet another whatsapp web wrapper with injected javascript. The app has been built from scratch - the UI/UX and the business logic.

---

## Highlights

- **Full WhatsApp Parity**: Real-time DMs, group chats, community channels, voice notes with interactive waveforms, stickers, reactions, media rendering, and dynamic call log tracking.
- **Background Worker Architecture**: Offloads network socket traffic (via Baileys), message decryption, and SQLite write transactions to dedicated Node.js background workers—keeping the UI fluid during massive syncs.
- **Built-in AI Assistant & Tool Engine**: Chat sidebar supporting multiple AI providers (Gemini, OpenAI, Groq, DeepSeek, Mistral, LM Studio, local Llama models). Features function calling, `@mentions` of chats/contacts, starred message prompt anchors, and citation tracking.Tools include ReadMessagesTool, QueryDatabaseTool,messageActionTool(edit/delete/forward/reply), ChatActionTool(pin,mute,archive,delete,markasunread/read) etc. These tools are registered dynamically with the AI agent and can be used by the agent to interact with the WhatsApp data and perform actions. It also supports custom tool registration from extensions.
- **🔌 Extension & Plugin System (`.scext`)**: Modulable runtime architecture allowing custom extensions packaged as `.scext` bundles. Extensions can inject virtual bot chats into the chat list, register AI agent tools, listen to live events, trigger LLMs, schedule background cron tasks,execute tools, and store private key-value data.
- **Semantic Search & Vector Embeddings**: On-device vector embeddings powered by `@xenova/transformers`, `onnxruntime-node`, and `sqlite-vec` for searching message histories by concept rather than just exact keywords.(using Conversational Thread Disentanglement)
- **Local REST API Server**: Embedded HTTP API server running locally on `127.0.0.1` with Bearer token authentication, allowing external scripts, workflows, or AI agents to programmatically query chats, read messages, and trigger actions.
- **Conversational Thread Disentanglement**: Built-in dataset annotation tools and PyTorch fine-tuning scripts (`train/`) to untangle chaotic multi-topic group conversations into clean, coherent threads. Note : the model has been trained on this architecture on real data . the data was about 90k pairs , and the model was fine-tuned on it. The fine tuned model gives AUC score of 0.98. this feature is not yet fully integrated.

---

## Extension & Plugin System

SmartChat features an isolated, capability-based Extension System. Extensions are packaged as `.scext` archives containing a `manifest.json`, entry script (`index.js`), and optional dependencies.

### Key Extension Capabilities

- **Virtual / Dedicated Bot Chats**: Register virtual bot chats in the main chat list (e.g. Unread Summarizer Bot, Voice Transcriber Bot) to interact directly with users.
- **Custom AI Tool Registration**: Dynamically inject custom functions and APIs into the main AI Agent tool loop.
- **Event Listeners**: Subscribe to real-time WhatsApp incoming messages, status changes, and participant updates.
- **Cron & Scheduler**: Schedule background cron jobs and recurring tasks using `node-cron`.
- **Isolated Storage**: Access dedicated per-extension key-value storage backed by Prisma SQLite (`ExtensionKV`).
- **LLM Access**: Prompt multi-provider LLMs directly from background extension scripts.
- **Tool Calling**: Extensions can call tools to perform actions in the app. 

### Future plans 
The app will be transitioned to a microkernel architecture inspired by VS Code, enabling extensions to be as powerful as built-in features by exposing and dogfooding the same API surface used by the app's internal features - keeping Security and privacy in mind as well.

### Packaged Extension Scripts

The `smartchat/scripts/` directory includes helper packagers for sample extensions:
```bash
cd smartchat
node scripts/package-unread-summarizer-bot.js
node scripts/package-voice-transcriber-bot.js
node scripts/package-all-features-bot.js
```

---

## 🛠️ Tech Stack

- **Framework**: Electron + Vite + React 19 + TypeScript
- **WhatsApp Engine**: `@whiskeysockets/baileys`
- **Database & Vectors**: SQLite (`better-sqlite3`), Prisma ORM, `sqlite-vec`
- **AI Integrations**: `@google/genai`, `openai`, `groq-sdk`, `@lmstudio/sdk`, `node-llama-cpp`
- **Media & Math**: `wavesurfer.js`, `fluent-ffmpeg`, `katex`, `@tiptap/react`
- **Machine Learning & Clustering**: `@xenova/transformers`, `umap-js`, `hdbscan-ts`, `ml-kmeans`
- **Extensions**: Custom `.scext` Zip Host & Capability Registry (`ExtensionHost`, `ExtensionLoader`)

---

## 🚀 Getting Started

### Prerequisites

- **Node.js**: v20 or higher recommended
- **npm**: v9 or higher

### Installation

```bash
# Clone the repository
git clone https://github.com/Bhaskar-kumar-arya/SmartChat.git
cd SmartChat/smartchat

# Install dependencies
npm install
```

### Running in Development

```bash
# Inside the smartchat directory
npm run dev
```

*Note: `npm run dev` automatically generates internal API/extension documentation (`generate-docs.js`) and starts Electron with Vite hot-reload.*

---

## 🏗️ Building for Production

```bash
# Build for Windows
npm run build:win

# Build for macOS
npm run build:mac

# Build for Linux
npm run build:linux
```

---

## 🧪 Testing & Native Module Switching

SmartChat uses `better-sqlite3` as a native C++ module. Because standard Node.js (used by `vitest`) and Electron require different native ABI compilations, you need to switch native binaries when running tests:

> [!IMPORTANT]
> Always stop the active dev server (`npm run dev`) before running tests to prevent SQLite database lock errors.

### Running Test Suites

```bash
# Run a single test file (automatically rebuilds better-sqlite3 for Node.js)
npm run test:run -- src/main/tests/basic.test.ts

# Run all test suites sequentially
npm run test:run:all
```

### Returning to App Development

After running tests, **you must rebuild native modules back for Electron** before running `npm run dev` again:

```bash
npm run test:rebuild:electron
```

---

## 🔌 Local HTTP API Server

SmartChat launches a local REST API server on `127.0.0.1` upon startup. External tools and local agents can interact with the app using Bearer token authentication.

- **Check API Status**: `GET http://127.0.0.1:<port>/api/status`
- **List Chats**: `GET http://127.0.0.1:<port>/api/chats`
- **Execute Native AI Tool**: `POST http://127.0.0.1:<port>/api/tools/execute`
- **Send Message**: `POST http://127.0.0.1:<port>/api/messages/send`

---

## 📂 Project Structure

```
SmartChat/
├── smartchat/                 # Main Electron application workspace
│   ├── docs/                  # Architectural Decision Records (ADRs) & system designs
│   │   ├── architecture/      # ADRs, Module maps, AI context design
│   │   └── future/            # Feature roadmaps and disentanglement research
│   ├── prisma/                # Database schema definitions & migrations
│   ├── scripts/               # Build helpers, doc generators & extension packagers
│   ├── src/
│   │   ├── main/              # Main process & background worker orchestration
│   │   │   ├── domain/        # Core entities & domain interfaces
│   │   │   ├── extensions/    # Extension host, capabilities, virtual chats & storage
│   │   │   ├── ipc/           # Inter-process communication payload types
│   │   │   ├── services/      # Business domain services (AI, WhatsApp, Search, Contacts)
│   │   │   ├── tools/         # Native tools available to the AI agent
│   │   │   └── workers/       # Background threads for WhatsApp connection & embeddings
│   │   ├── preload/           # Secure contextBridge API bindings
│   │   └── renderer/          # React UI frontend (Components, Hooks, Context, Styling)
│   └── train/                 # Thread disentanglement dataset generator & trainer
├── to-dos/                    # Development guides and roadmaps
└── whatsmeow/                 # Protocol implementation references
```

---

## Architecture & Design Decisions

SmartChat follows **SOLID** software principles, layered modular architecture, and interface segregation to isolate core business domains from transport libraries.

For detailed technical designs, see:
- [Module Boundary Map](file:///smartchat/docs/architecture/modules.md)
- [Architecture Decision Records (ADR)](file:///smartchat/docs/architecture/ADR.md)
- [Chat Disentanglement Design](file:///smartchat/docs/future/chat_disentaglement.md)

---

## 📄 License

Distributed under the GNU Affero General Public License v3.0 (AGPLv3). See [LICENSE](file:///LICENSE) for details.
