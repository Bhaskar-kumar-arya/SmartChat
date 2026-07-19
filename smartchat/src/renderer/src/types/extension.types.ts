// Phase 9: Shared renderer-side types for the Extension System

export interface SlashCommand {
  command: string
  description: string
}

export interface ExtensionManifest {
  id: string
  version: string
  name: string
  description: string
  permissions: string[]
  dedicatedChat?: {
    name: string
    avatarEmoji: string
    commands: SlashCommand[]
  }
}

export interface LoadedExtension {
  id: string
  manifest: ExtensionManifest
}

export interface ExtensionChatMessage {
  id: string
  extensionId: string
  role: 'user' | 'extension'
  content: string // JSON string: { type, text?, title?, body?, buttons? }
  createdAt: string
}

export interface ParsedContent {
  type: string
  text?: string
  title?: string
  body?: string
  buttons?: Array<{ id: string; label: string }>
  buttonId?: string
}

