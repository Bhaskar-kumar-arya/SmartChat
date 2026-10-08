// Phase 9: Shared renderer-side types for the Extension System
export type {
  SlashCommand,
  ExtensionManifest,
  LoadedExtension,
  ExtensionChatMessage
} from '../../../shared/ipc/dto'

export interface ParsedContent {
  type: string
  text?: string
  title?: string
  body?: string
  buttons?: Array<{ id: string; label: string }>
  buttonId?: string
}

