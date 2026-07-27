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
  registerSidebarPanel?: (id: string, opts: { title: string; icon?: string; panel?: string }) => void
  registerSettingsPage?: (id: string, opts: { title: string; panel?: string }) => void
  registerMessageRenderer?: (id: string, opts: { messageType: string; panel?: string }) => void
  registerCompletionProvider?: (id: string, provide: (ctx: unknown) => Promise<unknown[]>) => void
  registerMessageSendInterceptor?: (id: string, intercept: (payload: unknown, next: unknown) => Promise<unknown>) => void
  exposeAPI?: (exportName: string, api: Record<string, unknown>) => void
  importAPI?: (pluginId: string, exportName: string) => Promise<Record<string, unknown>>
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
