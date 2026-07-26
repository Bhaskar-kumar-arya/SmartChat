import { PluginManifest } from './PluginManifest'

export interface IPluginLogAPI {
  info(msg: string, ...data: unknown[]): void
  warn(msg: string, ...data: unknown[]): void
  error(msg: string, ...data: unknown[]): void
}

export interface IPluginContributionsAPI {
  registerChatAction?: (id: string, handler: (ctx: unknown) => Promise<void>) => void
  registerMessageAction?: (id: string, handler: (ctx: unknown) => Promise<void>) => void
  registerChatBadge?: (id: string, compute: (chatJid: string) => Promise<unknown>) => void
  registerSlashCommand?: (name: string, handler: (args: string, context: unknown) => Promise<void>) => void
  registerAITool?: (name: string, execute: (args: Record<string, unknown>) => Promise<{ text: string }>) => void
  [key: string]: unknown
}

export interface PluginContext {
  readonly id: string
  readonly manifest: PluginManifest
  onActivate?(fn: () => Promise<void>): void
  onDeactivate?(fn: () => Promise<void>): void
  readonly log?: IPluginLogAPI
  readonly contributions?: IPluginContributionsAPI
  [key: string]: unknown
}
