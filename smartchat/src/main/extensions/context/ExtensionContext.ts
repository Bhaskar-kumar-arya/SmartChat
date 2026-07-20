import { ExtensionManifest } from '../types/ExtensionManifest'
import { ExtensionEventName, ExtensionEventMap } from './ExtensionEventMap'

export interface IExtensionEventAPI {
  on<K extends ExtensionEventName>(
    event: K,
    handler: (payload: ExtensionEventMap[K]) => void | Promise<void>
  ): () => void
}

export interface IExtensionLogAPI {
  info(msg: string, ...data: any[]): void
  warn(msg: string, ...data: any[]): void
  error(msg: string, ...data: any[]): void
}

export interface IExtensionStorageAPI {
  get<T = unknown>(key: string): Promise<T | undefined>
  set(key: string, value: unknown): Promise<void>
  delete(key: string): Promise<void>
  clear(): Promise<void>
  keys(): Promise<string[]>
}

export interface IExtensionSchedulerAPI {
  setInterval(ms: number, fn: () => void | Promise<void>): () => void
  setTimeout(ms: number, fn: () => void | Promise<void>): () => void
  onCron(name: string, fn: () => void | Promise<void>): void
}

export interface ToolResult {
  text: string;
}

export interface ExtensionTool {
  name: string;
  description: string;
  schema: object;
  execute: (args: Record<string, unknown>) => Promise<ToolResult>;
}

export interface IExtensionToolCallAPI {
  call(toolName: string, args: Record<string, unknown>): Promise<ToolResult>;
  list(): string[];
}

export interface IExtensionToolRegisterAPI {
  register(tool: ExtensionTool): void;
  list(): string[];
}

export type IExtensionToolAPI = Partial<IExtensionToolCallAPI & IExtensionToolRegisterAPI>;




export interface NotifyAction {
  id: string
  title: string
}

export interface DedicatedChatMessage {
  id: string
  extensionId: string
  role: 'user' | 'extension'
  content: string | any
  createdAt: Date
}

export interface DedicatedChatContent {
  type: 'text' | 'card'
  text?: string
  title?: string
  body?: string
  buttons?: Array<{ id: string; label: string }>
}

export interface IExtensionDedicatedChatAPI {
  send(content: DedicatedChatContent): Promise<void>
  getHistory(limit?: number): Promise<DedicatedChatMessage[]>
  clearHistory(): Promise<void>
  focus(): void
}

export interface IExtensionUIAPI {
  notify(opts: { title: string; body: string; action?: NotifyAction }): Promise<void>
  toast(msg: string, level?: 'info' | 'success' | 'warning' | 'error'): void
  showSettings(schema: object): Promise<Record<string, unknown>>
}

export interface ExtensionContext {
  readonly extensionId: string
  readonly manifest: ExtensionManifest
  readonly log: IExtensionLogAPI

  onActivate(fn: () => Promise<void>): void
  onDeactivate(fn: () => Promise<void>): void

  readonly storage?: IExtensionStorageAPI
  readonly events?: IExtensionEventAPI
  readonly scheduler?: IExtensionSchedulerAPI
  readonly tools?: IExtensionToolAPI
  readonly ui?: IExtensionUIAPI
  readonly dedicatedChat?: IExtensionDedicatedChatAPI
}
