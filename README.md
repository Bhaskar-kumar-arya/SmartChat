# SmartChat

SmartChat is a modern desktop chat client that brings WhatsApp Web into an Electron application powered by an intelligent AI workspace and a **VS Code-inspired Microkernel Architecture**.

Unlike traditional chat clients, SmartChat bridges WhatsApp messaging with multi-provider LLMs (Gemini, OpenAI, Groq, DeepSeek, LM Studio), on-device vector search, an extensible microkernel plugin ecosystem, local HTTP automation APIs, and conversation disentanglement capabilities. Built completely from scratch—both the UI/UX and business logic—SmartChat provides power users with extreme customization, security, and extensibility.

---

## Highlights

- **Full WhatsApp Parity**: Real-time DMs, group chats, community channels, voice notes with interactive waveforms, stickers, reactions, media rendering, and dynamic call log tracking.
- **🔌 VS Code-Inspired Microkernel Architecture**: A modular, decoupled plugin architecture where both built-in features and external `.scext` plugins interact through versioned Kernel APIs (`IKernelModule`), capability-based security (ABAC), and typed contribution points.
- **📦 `@smartchat/sdk` Package**: Author plugins using `@smartchat/sdk` with strong TypeScript typing, manifest validation, CLI packager, and isolated worker-thread runtime wrappers.
- **🎨 Dynamic UI & Overlay System**: Plugins can collect user input using native host-rendered forms, confirm dialogs, and alerts, or render full custom interfaces via floating modal overlays, sidebar panels, and settings pages—all automatically matching SmartChat's dark mode and design system.
- **Background Worker Architecture**: Offloads network socket traffic (via Baileys), message decryption, and SQLite write transactions to dedicated Node.js background workers—keeping the UI fluid during massive syncs.
- **Built-in AI Assistant & Tool Engine**: Chat sidebar supporting multiple AI providers (Gemini, OpenAI, Groq, DeepSeek, Mistral, LM Studio, local Llama models). Features function calling, `@mentions` of chats/contacts, starred message prompt anchors, citation tracking, and dynamic tool auto-discovery from loaded plugins.
- **Semantic Search & Vector Embeddings**: On-device vector embeddings powered by `@xenova/transformers`, `onnxruntime-node`, and `sqlite-vec` for searching message histories by concept rather than just exact keywords.
- **Local REST API Server**: Embedded HTTP API server running locally on `127.0.0.1` with Bearer token authentication, allowing external scripts, workflows, or AI agents to programmatically query chats, read messages, and trigger actions.
- **Conversational Thread Disentanglement**: Built-in dataset annotation tools and PyTorch fine-tuning scripts (`train/`) to untangle chaotic multi-topic group conversations into clean, coherent threads (trained on ~90k pairs with an AUC score of 0.98).

---

## 🔌 Microkernel Plugin Architecture

SmartChat features a robust **VS Code-inspired Microkernel Architecture**. Under this model, the minimal core kernel exposes versioned API surfaces (`IKernelModule`), and both built-in internal features and external plugins consume the **exact same Kernel APIs** and register into typed contribution slots.

```
                    ┌──────────────────────────────────────────────┐
                    │            Electron Main Process             │
                    │                                              │
                    │   ┌──────────────────────────────────────┐   │
                    │   │            Kernel Core               │   │
                    │   │  • ContributionRegistry              │   │
                    │   │  • PermissionStore (ABAC)            │   │
                    │   │  • KernelAPIRouter                   │   │
                    │   │  • PluginHost & PluginLoader         │   │
                    │   └──────────────────┬───────────────────┘   │
                    │                      │                       │
                    │        ┌─────────────┴────────────┐          │
                    │        ▼                          ▼          │
                    │  DirectChannel             WorkerChannel     │
                    │  (In-Process)            (worker_threads)    │
                    │        │                          │          │
                    └────────┼──────────────────────────┼──────────┘
                             │                          │
                             ▼                          ▼
                   ┌──────────────────┐       ┌──────────────────┐
                   │ Built-in Plugins │       │ External Plugins │
                   │  • WhatsappCore  │       │  • Voice         │
                   │  • AIAssistant   │       │    Transcriber   │
                   │  • Search        │       │  • (.scext Zip)  │
                   │  • Notifications │       │                  │
                   └──────────────────┘       └──────────────────┘
```

### Architecture Core Principles

1. **Minimal Kernel Core**: All database access (Prisma/SQLite), WhatsApp network sockets (Baileys), typed event routing, plugin lifecycle management, and contribution registries are owned by the kernel.
2. **Dual Plugin Isolation Modes**:
   - **External Plugins (`WorkerPluginChannel`)**: Run inside dedicated Node.js `worker_threads` communicating via MessagePorts. Protects heap state while avoiding full process serialization overhead.
   - **Built-in Plugins (`DirectPluginChannel`)**: Internal features dogfood the exact same `IPluginChannel` and contribution contracts in-process with zero serialization penalty.
3. **Capability-Based Security & ABAC**: Plugins declare required capabilities (`chats:read`, `messages:send`, `ui:overlay`, `ui:panel`, etc.) in their manifest v2. The `IPermissionStore` enforces coarse capability checks and fine-grained resource scope matching (JID allowlists/denylists) at every API boundary.
4. **Typed Contribution Slots**:
   Plugins register contributions declaratively in `manifest.json` or imperatively during activation:
   - `chat-action` & `message-action`: Context menu actions with JSON `when` condition trees (`eq`, `neq`, `in`, `nin`, `and`, `or`), recursive submenus, and custom icon rendering (raw SVG strings, image URLs, or Lucide icons).
   - `sidebar-panel` & `settings-page`: Full panel mode rendered in the main stage or settings modal via sandboxed `<webview>`s.
   - `ai-tool`: Custom AI tools auto-discovered by Gemini/OpenAI multi-provider LLMs.
   - `slash-command`: Interactive chatbar command execution (e.g. `/transcribe`, `/translate`).
   - `chat-badge`, `keyboard-shortcut`, `status-bar-item`, `chat-filter`, `chat-sort-strategy`, `completion-provider`, `message-send-pipeline`, `plugin-api-export`.

---

## 🎨 Plugin UI & Overlay System

Plugins seamlessly integrate into SmartChat's user interface, offering flexible options ranging from simple dialogs to full custom UI components:

- **Declarative Forms & Dialogs**: Plugins can prompt users for input (`showForm`), display confirmation prompts (`showConfirm`), or surface informational alerts (`showAlert`). These render natively using the host app's React components for instant response times and consistent styling.
- **Custom Overlays & Modals**: For rich visual tools (such as live translators or search utilities), plugins can launch floating modal overlays (`showOverlay`) with bidirectional real-time data streaming.
- **Sidebar Panels & Settings Pages**: Plugins can contribute dedicated navigation panels to SmartChat's sidebar workspace (`sidebar-panel`) or add custom configuration tabs into the main settings menu (`settings-page`).
- **Automatic Theme & Design Integration**: SmartChat automatically passes its active CSS color scheme and design tokens to plugin UI elements so external components match the rest of the application.

---

## 📦 `@smartchat/sdk`

Plugin development is supported by `@smartchat/sdk` located in `packages/sdk/`.

### Key SDK Features

- **TypeScript Definitions**: Complete types for `PluginContext`, kernel APIs, contribution shapes, and manifest schemas.
- **Runtime Environment (`WorkerPluginRuntime`)**: Handles request-response correlation and translates plugin API calls into worker `postMessage` protocol requests.
- **Manifest v2 & Zod Validation**: Validates `manifest.json` schema (`apiVersion: "2"`).
- **CLI Packaging Tool**: CLI command to package plugin directories into valid `.scext` archives:
  ```bash
  npx smartchat-sdk package ./my-plugin
  ```

---

## 📽️ Demo & Sample Plugins

### Sample Plugins
- **Voice Transcriber (`com.smartchat.voice-transcriber`)**: External `.scext` plugin contributing a "Transcribe Audio" message action using FFmpeg audio decoding and `@xenova/transformers` Whisper AI speech recognition.
- **Built-in Plugins**: `WhatsappCorePlugin` (pin, mute, archive actions), `AIAssistantPlugin` (AI tools), `SearchPlugin` (search sidebar panel), `NotificationsPlugin` (settings panel).

### Demos & Recordings
- **Custom Message Actions & Notifications**:
  https://github.com/Bhaskar-kumar-arya/SmartChat/raw/main/smartchat/Extensions-demo-videos/customeMessageActionAndNotifications.mp4
- **Custom Slash Commands**:
  https://github.com/Bhaskar-kumar-arya/SmartChat/raw/main/smartchat/Extensions-demo-videos/customSlashCommands.mp4

---

## 🛠️ Tech Stack

- **Framework**: Electron + Vite + React 19 + TypeScript
- **Microkernel Engine**: `@smartchat/sdk`, `WorkerPluginChannel`, `DirectPluginChannel`, `KernelAPIRouter`, `PermissionStore` (ABAC), `plugin://` protocol
- **WhatsApp Engine**: `@whiskeysockets/baileys`
- **Database & Vectors**: SQLite (`better-sqlite3`), Prisma ORM, `sqlite-vec`
- **AI Integrations**: `@google/genai`, `openai`, `groq-sdk`, `@lmstudio/sdk`, `node-llama-cpp`


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

*Note: `npm run dev` starts Electron with Vite hot-reload.*

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

SmartChat uses `better-sqlite3` as a native C++ module. Standard Node.js (used by `vitest`) and Electron require different native ABI compilations.

> [!IMPORTANT]
> Stop the active dev server (`npm run dev`) before running tests.

### Running Test Suites

```bash
# Run a single test file (automatically rebuilds better-sqlite3 for Node.js)
npm run test:run -- src/main/tests/kernel/api-modules/KernelMessagesModule.test.ts

# Run all test suites
npm run test:run:all

# Perform TypeScript type checking
npm run typecheck
```

### Returning to App Development

After running tests, **you must rebuild native modules back for Electron** before running `npm run dev` again:

```bash
npm run test:rebuild:electron
```

---

## 🔌 Local REST API Server

SmartChat launches a local REST API server on `127.0.0.1` upon startup with Bearer token authentication.

- **Check API Status**: `GET http://127.0.0.1:<port>/api/status`
- **List Chats**: `GET http://127.0.0.1:<port>/api/chats`
- **Execute Native AI Tool**: `POST http://127.0.0.1:<port>/api/tools/execute`
- **Send Message**: `POST http://127.0.0.1:<port>/api/messages/send`

---

## 📂 Project Structure

```
SmartChat/
├── packages/
│   └── sdk/                   # @smartchat/sdk package (manifest schema, worker runtime, CLI packager)
├── plugins/
│   └── voice-transcriber-plugin/ # Standalone external .scext plugin (Whisper AI + FFmpeg)
├── smartchat/                 # Main Electron application workspace
│   ├── docs/                  # Architectural Decision Records (ADRs) & Microkernel Specs
│   │   ├── architecture/      # microkernel.md, microkernel-phases.md, ADRs
│   │   └── future/            # Feature roadmaps and disentanglement research
│   ├── prisma/                # Database schema definitions & migrations
│   ├── scripts/               # Build helpers & plugin packaging scripts
│   ├── src/
│   │   ├── main/              # Main process & microkernel engine
│   │   │   ├── kernel/        # Microkernel core (channels, router, permissions, host, API modules)
│   │   │   ├── plugins/       # Built-in plugins (whatsapp-core, ai-assistant, search, notifications)
│   │   │   ├── domain/        # Domain entities & interfaces
│   │   │   ├── services/      # Business domain services (AI, WhatsApp, Search, Contacts)
│   │   │   └── workers/       # Background threads for Baileys & vector embeddings
│   │   ├── preload/           # Secure contextBridge, overlay-preload & panel-preload bindings
│   │   └── renderer/          # React UI frontend (Components, Hooks, Context, Styling, Modals)
│   └── train/                 # Thread disentanglement dataset generator & trainer
└── to-dos/                    # Development guides and roadmaps
```

---

## Architecture & Design Decisions

SmartChat follows **SOLID** principles, layered modular architecture, and interface segregation to isolate core business domains from transport libraries.

For detailed technical specs and ADRs, see:
- [Microkernel Architecture Specification](smartchat/docs/architecture/microkernel.md)
- [Microkernel Phase Tracker & Deliverables](smartchat/docs/architecture/microkernel-phases.md)
- [Module Boundary Map](smartchat/docs/architecture/modules.md)
- [Architecture Decision Records (ADR)](smartchat/docs/architecture/ADR.md)
- [Chat Disentanglement Design](smartchat/docs/future/chat_disentaglement.md)

---

## 📄 License

Distributed under the GNU Affero General Public License v3.0 (AGPLv3). See [LICENSE](file:///LICENSE) for details.