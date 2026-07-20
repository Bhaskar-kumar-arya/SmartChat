import { IDocSource } from './IDocSource'

export interface IDocRegistry {
  register(source: IDocSource): void
  buildDocs(): string
}

export class DocRegistry implements IDocRegistry {
  private sources: IDocSource[] = []

  public register(source: IDocSource): void {
    this.sources.push(source)
  }

  public buildDocs(): string {
    const preamble = `SmartChat Extension API Reference
Generated: ${new Date().toISOString().split('T')[0]}
API Version: 1
==========================================

SmartChat is an Electron-based WhatsApp desktop client with an extension
system that lets third-party developers add automation, AI tools, bots,
and integrations. Extensions run inside the Electron main process (Node.js)
with a capability-gated sandbox — they can only access the APIs they
explicitly declare in their manifest.

==========================================
SECTION 0 — PACKAGE FORMAT & INSTALLATION
==========================================
An extension is a ZIP archive with a ".scext" file extension.
Contents:
  my-extension/
  ├── manifest.json   (required — describes the extension)
  └── index.js        (required — CommonJS entry point)

To install: open the Extension Manager in SmartChat and click "Install".
The .scext file is extracted to the user's data directory and loaded
automatically on subsequent app starts.

Third-Party Node Modules:
  Because extensions run inside a standard Node.js/CommonJS environment, you
  can package third-party npm dependencies with your extension. Simply run
  "npm install" in your extension directory and include the "node_modules"
  folder inside your ZIP package.

Node.js Core Modules:
  You have full access to Node.js core modules (e.g. "fs", "path", "crypto",
  "http", "https"). You can import them using require():
    const fs = require('fs')
    const https = require('https')


==========================================
SECTION 1 — ENTRY POINT PATTERNS
==========================================
SmartChat supports two patterns for the extension entry point:

PATTERN A — Default export function (simplest):
  // index.js
  module.exports = async function(ctx) {
    ctx.log.info('Extension activated!')
    ctx.onActivate(async () => { /* called after setup */ })
    ctx.onDeactivate(async () => { /* cleanup */ })
  }

PATTERN B — Named activate/deactivate exports:
  // index.js
  module.exports = {
    activate: async (ctx) => { ctx.log.info('on') },
    deactivate: async () => { ctx.log.info('off') }
  }

The ctx (ExtensionContext) object is passed on load. It is read-only and
already scoped to your extension — no other extension's data is accessible.

==========================================
SECTION 2 — EXTENSION CONTEXT SHAPE
==========================================
interface ExtensionContext {
  readonly extensionId: string          // your manifest "id"
  readonly manifest: ExtensionManifest  // the parsed manifest object
  readonly log: IExtensionLogAPI        // always available

  onActivate(fn: () => Promise<void>): void    // called after init
  onDeactivate(fn: () => Promise<void>): void  // called before unload

  // Capability APIs — only present when you have the correct permission:
  readonly storage?:       IExtensionStorageAPI
  readonly events?:        IExtensionEventAPI
  readonly scheduler?:     IExtensionSchedulerAPI
  readonly tools?:         IExtensionToolAPI
  readonly contacts?:      IExtensionContactsAPI
  readonly chats?:         IExtensionChatsAPI
  readonly ui?:            IExtensionUIAPI
  readonly dedicatedChat?: IExtensionDedicatedChatAPI
}

Always guard optional capabilities before use:
  if (ctx.storage) { await ctx.storage.set('key', 'value') }

==========================================
SECTION 3 — MANIFEST REFERENCE
==========================================
Required fields:
  id          : string   — reverse-domain style, e.g. "com.example.my-bot"
  version     : string   — semver, e.g. "1.0.0"
  apiVersion  : string   — must be "1"
  name        : string   — display name shown in the Extension Manager
  description : string   — one-line description
  main        : string   — entry point relative to extension root, e.g. "index.js"
  permissions : string[] — list of capability permissions (see each section below)

Optional fields:
  dedicatedChat:
    name        : string  — bot name shown in the sidebar chat
    avatarEmoji : string  — single emoji used as the bot's avatar
    commands    : Array<{ name: string, description: string }>
                — slash commands the user can type in the bot chat
                  (received via ctx.events.on('extension:chat-message', ...))

  scheduler:
    onStart   : boolean  — if true, runs the extension entry point on app start
    intervals : Array<{ name: string, cron: string }>
              — named cron jobs registered via ctx.scheduler.onCron(name, fn)

Full example manifest.json:
{
  "id": "com.example.omni-bot",
  "version": "1.0.0",
  "apiVersion": "1",
  "name": "Omni Bot",
  "description": "Forwards tagged messages to a webhook",
  "main": "index.js",
  "permissions": [
    "events:message:incoming",
    "storage:read",
    "storage:write",
    "ui:notification",
    "ui:dedicated_chat"
  ],
  "dedicatedChat": {
    "name": "Omni Bot",
    "avatarEmoji": "🤖",
    "commands": [
      { "name": "status", "description": "Show current bot status" }
    ]
  },
  "scheduler": {
    "onStart": true,
    "intervals": [
      { "name": "heartbeat", "cron": "*/5 * * * *" }
    ]
  }
}

==========================================
SECTION 4 — CAPABILITY API REFERENCE
==========================================
Each section below documents one capability. The "Permissions" line lists
what you must add to your manifest "permissions" array to unlock it.
`

    let docs = preamble

    for (const source of this.sources) {
      const section = source.getDocSection()
      docs += `\n\n[${section.heading}]\n`
      docs += `Permissions: ${section.permissions.length > 0 ? section.permissions.join(', ') : 'none'}\n`
      docs += `------------------------------------------\n`
      docs += `${section.body}\n`
    }

    return docs.trim()
  }
}
