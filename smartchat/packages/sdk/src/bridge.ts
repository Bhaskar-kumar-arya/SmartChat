import {
  IPluginChatsAPI,
  IPluginMessagesAPI,
  IPluginContactsAPI,
  IPluginAIAPI,
  IPluginStorageAPI,
  IPluginLogAPI,
  PluginContactInput,
  SendMessageOptions,
  AICallOptions
} from './context'

export type RequestFn = <T = unknown>(type: string, payload?: unknown) => Promise<T>

export interface KernelApiBridge {
  chats: IPluginChatsAPI
  messages: IPluginMessagesAPI
  contacts: IPluginContactsAPI
  ai: IPluginAIAPI
  storage: IPluginStorageAPI
  log: IPluginLogAPI
}

export function createKernelApiBridge(request: RequestFn): KernelApiBridge {
  return {
    chats: {
      getList: (page = 1, limit = 20) => request('kernel:chats:getList', { page, limit }),
      getById: (jid: string) => request('kernel:chats:getById', { jid }),
      getGroupParticipants: (jid: string) => request('kernel:chats:getGroupParticipants', { jid }),
      pin: (jid: string) => request('kernel:chats:pin', { jid }),
      unpin: (jid: string) => request('kernel:chats:unpin', { jid }),
      archive: (jid: string) => request('kernel:chats:archive', { jid }),
      unarchive: (jid: string) => request('kernel:chats:unarchive', { jid }),
      mute: (jid: string, durationMs: number) => request('kernel:chats:mute', { jid, durationMs }),
      unmute: (jid: string) => request('kernel:chats:unmute', { jid }),
      markRead: (jid: string) => request('kernel:chats:markRead', { jid })
    },
    messages: {
      getMessages: (jid: string, page = 1, limit = 50) => request('kernel:messages:getMessages', { jid, page, limit }),
      getMessagesAroundId: (jid: string, messageId: string, lookBehind = 20) => request('kernel:messages:getMessagesAroundId', { jid, messageId, lookBehind }),
      send: (jid: string, text: string, options?: SendMessageOptions) => request('kernel:messages:send', { jid, text, options }),
      sendMedia: (jid: string, filePath: string, caption?: string, options?: SendMessageOptions) => request('kernel:messages:sendMedia', { jid, filePath, caption, options }),
      edit: (jid: string, messageId: string, newText: string) => request('kernel:messages:edit', { messageId, newText, jid }),
      forward: (jid: string, messageId: string, targetJids: string[]) => request('kernel:messages:forward', { messageId, targetJids, jid }),
      delete: (jid: string, messageId: string) => request('kernel:messages:delete', { jid, messageId }),
      react: (jid: string, messageId: string, emoji: string) => request('kernel:messages:react', { jid, messageId, emoji }),
      downloadMedia: (messageId: string) => request('kernel:messages:downloadMedia', { messageId }),
      getReceipts: (messageId: string) => request('kernel:messages:getReceipts', { messageId }),
      addFavoriteSticker: (messageId: string) => request('kernel:messages:addFavoriteSticker', { messageId }),
      getFavoriteStickers: () => request('kernel:messages:getFavoriteStickers', {})
    },
    contacts: {
      getByJid: (jid: string) => request('kernel:contacts:getByJid', { jid }),
      batchGetByJids: (jids: string[]) => request('kernel:contacts:batchGetByJids', { jids }),
      getMe: () => request('kernel:contacts:getMe', {}),
      upsertContact: (contact: PluginContactInput) => request('kernel:contacts:upsertContact', { contact }),
      resolveLid: (jid: string) => request('kernel:contacts:resolveLid', { jid }),
      getAlias: (jid: string) => request('kernel:contacts:getAlias', { jid })
    },
    ai: {
      chat: (prompt: string, options?: AICallOptions) => request('kernel:ai:chat', { prompt, options }),
      callTool: (toolName: string, args: Record<string, unknown>) => request('kernel:ai:callTool', { toolName, args }),
      getAvailableModels: () => request('kernel:ai:getAvailableModels', {}),
      createSession: (title: string, modelId?: string) => request('kernel:ai:createSession', { title, modelId }),
      listSessions: (page = 1, pageSize = 20) => request('kernel:ai:listSessions', { page, pageSize }),
      getSession: (id: string) => request('kernel:ai:getSession', { id }),
      renameSession: (id: string, title: string) => request('kernel:ai:renameSession', { id, title }),
      deleteSession: (id: string) => request('kernel:ai:deleteSession', { id })
    },
    storage: {
      get: <T = unknown>(key: string) => request<T>('kernel:storage:get', { key }),
      set: (key: string, value: unknown) => request('kernel:storage:set', { key, value }),
      delete: (key: string) => request('kernel:storage:delete', { key }),
      clear: () => request('kernel:storage:clear', {}),
      keys: () => request<string[]>('kernel:storage:keys', {})
    },
    log: {
      // Fire-and-forget: the caller never awaits a log, so swallow the response
      // promise (and any rejection from a torn-down channel) instead of leaving
      // it floating.
      info: (msg: string, ...d: unknown[]) => void Promise.resolve(request('kernel:log', { level: 'info', message: msg, data: d })).catch(() => {}),
      warn: (msg: string, ...d: unknown[]) => void Promise.resolve(request('kernel:log', { level: 'warn', message: msg, data: d })).catch(() => {}),
      error: (msg: string, ...d: unknown[]) => void Promise.resolve(request('kernel:log', { level: 'error', message: msg, data: d })).catch(() => {})
    }

  }
}
