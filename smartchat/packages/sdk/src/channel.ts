import { MessagePort } from 'node:worker_threads'
import { PluginManifest } from './manifest'
import {
  PluginContext,
  IPluginLogAPI,
  IPluginChatsAPI,
  IPluginMessagesAPI,
  IPluginContactsAPI,
  IPluginAIAPI,
  IPluginEventsAPI,
  IPluginStorageAPI,
  IPluginUIAPI,
  IPluginSchedulerAPI,
  IPluginContributionsAPI,
  ChatActionContext,
  MessageActionContext,
  CommandContext,
  BadgeDescriptor,
  CompletionContext,
  CompletionItem,
  OutgoingMessagePayload,
  SendResult,
  SendMessageOptions,
  AICallOptions
} from './context'

export interface KernelRequest {
  id: string
  type: string
  payload: unknown
}

export interface KernelResponse {
  id: string
  ok: boolean
  payload?: unknown
  error?: {
    code: string
    message: string
    permission?: string
  }
}

interface PendingRequest {
  resolve: (value: any) => void
  reject: (error: Error) => void
  timer?: NodeJS.Timeout
}

export type RequestHandler = (req: KernelRequest) => Promise<unknown>

export interface WorkerPluginRuntimeOptions {
  requestTimeoutMs?: number
}

function isKernelResponse(msg: unknown): msg is KernelResponse {
  return (
    typeof msg === 'object' &&
    msg !== null &&
    'id' in msg &&
    'ok' in msg &&
    typeof (msg as KernelResponse).id === 'string' &&
    typeof (msg as KernelResponse).ok === 'boolean'
  )
}

function isKernelRequest(msg: unknown): msg is KernelRequest {
  return (
    typeof msg === 'object' &&
    msg !== null &&
    'id' in msg &&
    'type' in msg &&
    typeof (msg as KernelRequest).id === 'string' &&
    typeof (msg as KernelRequest).type === 'string'
  )
}

export class WorkerPluginRuntime {
  private pendingRequests = new Map<string, PendingRequest>()
  private activateCallbacks: Array<() => Promise<void>> = []
  private deactivateCallbacks: Array<() => Promise<void>> = []

  private chatActionHandlers = new Map<string, (ctx: ChatActionContext) => Promise<void>>()
  private messageActionHandlers = new Map<string, (ctx: MessageActionContext) => Promise<void>>()
  private chatBadgeComputers = new Map<string, (chatJid: string) => Promise<BadgeDescriptor | null>>()
  private slashCommandHandlers = new Map<string, (args: string, context: CommandContext) => Promise<void>>()
  private aiToolExecutors = new Map<string, (args: Record<string, unknown>) => Promise<{ text: string }>>()
  private completionProviders = new Map<string, (ctx: CompletionContext) => Promise<CompletionItem[]>>()
  private sendInterceptors = new Map<string, (payload: OutgoingMessagePayload, next: (p: OutgoingMessagePayload) => Promise<SendResult>) => Promise<SendResult>>()
  private eventHandlers = new Map<string, Array<(payload: any) => void | Promise<void>>>()
  private exposedAPIs = new Map<string, Record<string, unknown>>()

  private incomingHandlers = new Map<string, RequestHandler>()
  private requestTimeoutMs: number

  constructor(
    private readonly port: MessagePort,
    private readonly manifest: PluginManifest,
    options?: WorkerPluginRuntimeOptions
  ) {
    this.requestTimeoutMs = options?.requestTimeoutMs ?? 10000
    this.registerDefaultHandlers()
    this.port.on('message', (msg: unknown) => this.handlePortMessage(msg))
  }

  public registerIncomingHandler(type: string, handler: RequestHandler): void {
    this.incomingHandlers.set(type, handler)
  }

  private registerDefaultHandlers(): void {
    this.registerIncomingHandler('plugin:activate', async () => {
      for (const fn of this.activateCallbacks) {
        await fn()
      }
    })

    this.registerIncomingHandler('plugin:deactivate', async () => {
      for (const fn of this.deactivateCallbacks) {
        await fn()
      }
    })

    this.registerIncomingHandler('kernel:events:emit', async (req) => {
      const { event, payload } = (req.payload as { event: string; payload: unknown }) || {}
      const handlers = this.eventHandlers.get(event)
      if (handlers) {
        for (const h of handlers) {
          await h(payload)
        }
      }
    })

    this.registerIncomingHandler('contribution:execute:chat-action', async (req) => {
      const { id, context } = (req.payload as any) || {}
      const actionId = id || req.type.split(':')[3]
      const handler = this.chatActionHandlers.get(actionId)
      if (handler) {
        await handler(context)
      } else {
        const err = new Error(`Chat action '${actionId}' not found`)
        ;(err as any).code = 'NOT_FOUND'
        throw err
      }
    })

    this.registerIncomingHandler('contribution:execute:message-action', async (req) => {
      const { id, context } = (req.payload as any) || {}
      const actionId = id || req.type.split(':')[3]
      const handler = this.messageActionHandlers.get(actionId)
      if (handler) {
        await handler(context)
      } else {
        const err = new Error(`Message action '${actionId}' not found`)
        ;(err as any).code = 'NOT_FOUND'
        throw err
      }
    })

    this.registerIncomingHandler('contribution:execute:slash-command', async (req) => {
      const { name, args, context } = (req.payload as any) || {}
      const handler = this.slashCommandHandlers.get(name)
      if (handler) {
        await handler(args, context)
      } else {
        const err = new Error(`Slash command '${name}' not found`)
        ;(err as any).code = 'NOT_FOUND'
        throw err
      }
    })

    this.registerIncomingHandler('contribution:execute:ai-tool', async (req) => {
      const { name, args } = (req.payload as any) || {}
      const executor = this.aiToolExecutors.get(name)
      if (executor) {
        return await executor(args)
      } else {
        const err = new Error(`AI tool '${name}' not found`)
        ;(err as any).code = 'NOT_FOUND'
        throw err
      }
    })

    this.registerIncomingHandler('contribution:compute:chat-badge', async (req) => {
      const { id, chatJid } = (req.payload as any) || {}
      const computer = this.chatBadgeComputers.get(id)
      if (computer) {
        return await computer(chatJid)
      } else {
        const err = new Error(`Chat badge computer '${id}' not found`)
        ;(err as any).code = 'NOT_FOUND'
        throw err
      }
    })

    this.registerIncomingHandler('contribution:execute:completion-provider', async (req) => {
      const { id, context } = (req.payload as any) || {}
      const provider = this.completionProviders.get(id)
      if (provider) {
        return await provider(context)
      } else {
        const err = new Error(`Completion provider '${id}' not found`)
        ;(err as any).code = 'NOT_FOUND'
        throw err
      }
    })

    this.registerIncomingHandler('contribution:execute:message-send-pipeline', async (req) => {
      const { id, payload, next } = (req.payload as any) || {}
      const interceptor = this.sendInterceptors.get(id)
      if (interceptor) {
        return await interceptor(payload, next)
      } else {
        const err = new Error(`Message send interceptor '${id}' not found`)
        ;(err as any).code = 'NOT_FOUND'
        throw err
      }
    })
  }

  private getRequestHandler(type: string): RequestHandler | undefined {
    if (this.incomingHandlers.has(type)) {
      return this.incomingHandlers.get(type)
    }
    const baseType = type.split(':').slice(0, 3).join(':')
    if (baseType !== type && this.incomingHandlers.has(baseType)) {
      return this.incomingHandlers.get(baseType)
    }
    return undefined
  }

  private handlePortMessage(msg: unknown): void {
    if (isKernelResponse(msg)) {
      const pending = this.pendingRequests.get(msg.id)
      if (pending) {
        if (pending.timer) clearTimeout(pending.timer)
        this.pendingRequests.delete(msg.id)

        if (msg.ok) {
          pending.resolve(msg.payload)
        } else {
          const err = new Error(msg.error?.message || 'Kernel request failed')
          if (msg.error?.permission) {
            ;(err as any).permission = msg.error.permission
          }
          if (msg.error?.code) {
            ;(err as any).code = msg.error.code
          }
          pending.reject(err)
        }
      }
    } else if (isKernelRequest(msg)) {
      void this.handleIncomingKernelRequest(msg)
    }
  }

  private async handleIncomingKernelRequest(req: KernelRequest): Promise<void> {
    try {
      const handler = this.getRequestHandler(req.type)
      if (!handler) {
        this.respondError(req.id, 'NOT_FOUND', `Unhandled incoming type '${req.type}'`)
        return
      }

      const result = await handler(req)
      this.respondSuccess(req.id, result)
    } catch (err: any) {
      const code = err?.code || 'INTERNAL_ERROR'
      this.respondError(req.id, code, err?.message || 'Error processing kernel request')
    }
  }

  private respondSuccess(id: string, payload?: unknown): void {
    const res: KernelResponse = { id, ok: true, payload }
    this.port.postMessage(res)
  }

  private respondError(id: string, code: string, message: string): void {
    const res: KernelResponse = { id, ok: false, error: { code, message } }
    this.port.postMessage(res)
  }

  public request<T = unknown>(type: string, payload?: unknown): Promise<T> {
    const id = `req_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`
    return new Promise<T>((resolve, reject) => {
      let timer: NodeJS.Timeout | undefined
      if (this.requestTimeoutMs > 0) {
        timer = setTimeout(() => {
          this.pendingRequests.delete(id)
          reject(new Error(`Request '${type}' timed out after ${this.requestTimeoutMs}ms`))
        }, this.requestTimeoutMs)
      }

      this.pendingRequests.set(id, { resolve, reject, timer })
      const req: KernelRequest = { id, type, payload }
      this.port.postMessage(req)
    })
  }

  public getContext(): PluginContext {
    const self = this

    const logAPI: IPluginLogAPI = {
      info(msg: string, ...data: unknown[]) {
        self.port.postMessage({
          type: 'kernel:log',
          payload: { level: 'info', message: msg, data }
        })
      },
      warn(msg: string, ...data: unknown[]) {
        self.port.postMessage({
          type: 'kernel:log',
          payload: { level: 'warn', message: msg, data }
        })
      },
      error(msg: string, ...data: unknown[]) {
        self.port.postMessage({
          type: 'kernel:log',
          payload: { level: 'error', message: msg, data }
        })
      }
    }

    const chatsAPI: IPluginChatsAPI = {
      getList: (page = 1, limit = 20) => self.request('kernel:chats:getList', { page, limit }),
      getById: (jid: string) => self.request('kernel:chats:getById', { jid }),
      getGroupParticipants: (jid: string) => self.request('kernel:chats:getGroupParticipants', { jid }),
      pin: (jid: string) => self.request('kernel:chats:pin', { jid }),
      unpin: (jid: string) => self.request('kernel:chats:unpin', { jid }),
      archive: (jid: string) => self.request('kernel:chats:archive', { jid }),
      unarchive: (jid: string) => self.request('kernel:chats:unarchive', { jid }),
      mute: (jid: string, durationMs: number) => self.request('kernel:chats:mute', { jid, durationMs }),
      unmute: (jid: string) => self.request('kernel:chats:unmute', { jid }),
      markRead: (jid: string) => self.request('kernel:chats:markRead', { jid })
    }

    const messagesAPI: IPluginMessagesAPI = {
      getMessages: (jid: string, page = 1, limit = 50) => self.request('kernel:messages:getMessages', { jid, page, limit }),
      getMessagesAroundId: (jid: string, messageId: string, lookBehind = 20) => self.request('kernel:messages:getMessagesAroundId', { jid, messageId, lookBehind }),
      send: (jid: string, text: string, options?: SendMessageOptions) => self.request('kernel:messages:send', { jid, text, options }),
      sendMedia: (jid: string, filePath: string, caption?: string, options?: SendMessageOptions) => self.request('kernel:messages:sendMedia', { jid, filePath, caption, options }),
      edit: (messageId: string, newText: string, jid?: string) => self.request('kernel:messages:edit', { messageId, newText, jid }),
      forward: (messageId: string, targetJids: string[], jid?: string) => self.request('kernel:messages:forward', { messageId, targetJids, jid }),
      delete: (jid: string, messageId: string) => self.request('kernel:messages:delete', { jid, messageId }),
      react: (jid: string, messageId: string, emoji: string) => self.request('kernel:messages:react', { jid, messageId, emoji }),
      downloadMedia: (messageId: string) => self.request('kernel:messages:downloadMedia', { messageId }),
      getReceipts: (messageId: string) => self.request('kernel:messages:getReceipts', { messageId }),
      addFavoriteSticker: (messageId: string) => self.request('kernel:messages:addFavoriteSticker', { messageId }),
      getFavoriteStickers: () => self.request('kernel:messages:getFavoriteStickers', {})
    }

    const contactsAPI: IPluginContactsAPI = {
      getByJid: (jid: string) => self.request('kernel:contacts:getByJid', { jid }),
      batchGetByJids: (jids: string[]) => self.request('kernel:contacts:batchGetByJids', { jids }),
      getMe: () => self.request('kernel:contacts:getMe', {}),
      upsertContact: (contact: import('./context').PluginContactInput) => self.request('kernel:contacts:upsertContact', { contact }),
      resolveLid: (jid: string) => self.request('kernel:contacts:resolveLid', { jid }),
      getAlias: (jid: string) => self.request('kernel:contacts:getAlias', { jid })
    }

    const aiAPI: IPluginAIAPI = {
      chat: (prompt: string, options?: AICallOptions) => self.request('kernel:ai:chat', { prompt, options }),
      callTool: (toolName: string, args: Record<string, unknown>) => self.request('kernel:ai:callTool', { toolName, args })
    }

    const eventsAPI: IPluginEventsAPI = {
      on: <K extends import('./events').PluginEventName>(event: K, handler: (payload: import('./events').PluginEventMap[K]) => void | Promise<void>) => {
        const evt = String(event)
        if (!self.eventHandlers.has(evt)) {
          self.eventHandlers.set(evt, [])
          void self.request('kernel:events:subscribe', { event: evt })
        }
        self.eventHandlers.get(evt)!.push(handler as any)

        return () => {
          const list = self.eventHandlers.get(evt)
          if (list) {
            const idx = list.indexOf(handler as any)
            if (idx >= 0) list.splice(idx, 1)
            if (list.length === 0) {
              self.eventHandlers.delete(evt)
              void self.request('kernel:events:unsubscribe', { event: evt })
            }
          }
        }
      }
    }

    const storageAPI: IPluginStorageAPI = {
      get: <T = unknown>(key: string) => self.request<T>('kernel:storage:get', { key }),
      set: (key: string, value: unknown) => self.request('kernel:storage:set', { key, value }),
      delete: (key: string) => self.request('kernel:storage:delete', { key }),
      clear: () => self.request('kernel:storage:clear', {}),
      keys: () => self.request<string[]>('kernel:storage:keys', {})
    }

    const uiAPI: IPluginUIAPI = {
      notify: (opts) => self.request('kernel:ui:notify', opts),
      toast: (msg, level = 'info') => void self.request('kernel:ui:toast', { message: msg, level })
    }

    const schedulerAPI: IPluginSchedulerAPI = {
      setInterval: (ms, fn) => {
        const id = setInterval(fn, ms)
        return () => clearInterval(id)
      },
      setTimeout: (ms, fn) => {
        const id = setTimeout(fn, ms)
        return () => clearTimeout(id)
      },
      onCron: (name, fn) => {
        self.eventHandlers.set(`cron:${name}`, [fn])
      }
    }

    const contributionsAPI: IPluginContributionsAPI = {
      registerChatAction: (id, handler) => {
        self.chatActionHandlers.set(id, handler)
      },
      registerMessageAction: (id, handler) => {
        self.messageActionHandlers.set(id, handler)
      },
      registerChatBadge: (id, compute) => {
        self.chatBadgeComputers.set(id, compute)
      },
      registerSlashCommand: (name, handler) => {
        self.slashCommandHandlers.set(name, handler)
      },
      registerAITool: (name, execute) => {
        self.aiToolExecutors.set(name, execute)
      },
      registerCompletionProvider: (id, provide) => {
        self.completionProviders.set(id, provide)
      },
      registerMessageSendInterceptor: (id, intercept) => {
        self.sendInterceptors.set(id, intercept)
      },
      exposeAPI: (exportName, api) => {
        self.exposedAPIs.set(exportName, api)
      },
      importAPI: (pluginId, exportName) => {
        return self.request<Record<string, unknown>>('kernel:plugins:importAPI', { pluginId, exportName })
      }
    }

    return {
      id: this.manifest.id,
      manifest: this.manifest,
      onActivate: (fn) => {
        this.activateCallbacks.push(fn)
      },
      onDeactivate: (fn) => {
        this.deactivateCallbacks.push(fn)
      },
      log: logAPI,
      chats: chatsAPI,
      messages: messagesAPI,
      contacts: contactsAPI,
      ai: aiAPI,
      events: eventsAPI,
      storage: storageAPI,
      ui: uiAPI,
      scheduler: schedulerAPI,
      contributions: contributionsAPI
    }
  }
}
