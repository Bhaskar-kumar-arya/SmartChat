import { ipcMain, app, dialog, BrowserWindow } from 'electron'
import fs from 'fs'
import { join } from 'path'
import { resolveInsideDir, isTrustedSender } from './ipc/ipcGuards'
import { ServiceContainer } from './ServiceContainer'
import { AIToolInitializer } from './services/ai/AIToolInitializer'
import { audioTranscoderService } from './services/audio/AudioTranscoderService'
import { WASocket } from './services/whatsapp/types'
import { WhatsAppConnectionManager } from './services/whatsapp/WhatsAppConnectionManager'
import { AIChatContext, AIHistoryMessage, AIMention } from './services/ai/IAIService'
import { AIChatMessageInput } from './services/ai/IAIChatSessionService'
import { ExportSession, ExportMessage } from './services/ai/IAIChatExportService'
import { NotificationPreferences } from './services/notification/INotificationService'
import { ChatListItem } from './ipc/chat.types'
import { ISecureFileRegistry } from './services/protocol/ISecureFileRegistry'

const DIR_NAME_TEMP = 'temp'
const PREFIX_VOICE = 'voice_'
const EXT_OGG = '.ogg'
// S10-05: bound `download-url-to-temp` — https only (no SSRF to http://localhost
// / LAN / metadata endpoints), a hard timeout, and a streamed byte cap so a
// multi-GB or hostile URL cannot OOM the main process.
const ALLOWED_DOWNLOAD_PROTOCOLS = new Set(['https:'])
const DOWNLOAD_TIMEOUT_MS = 30_000
const MAX_DOWNLOAD_BYTES = 100 * 1024 * 1024
const EVENT_EMBEDDING_PROGRESS = 'embedding-progress'
const EVENT_EMBEDDING_STATE = 'embedding-state'

export function registerIpcHandlers(
  services: ServiceContainer,
  getSock: () => WASocket | null,
  waConnectionManager: WhatsAppConnectionManager,
  secureRegistry: ISecureFileRegistry
): void {
  registerChatAndMessageHandlers(services, getSock)
  registerMediaAndFileHandlers(services, getSock, secureRegistry)
  registerStickerHandlers(services)
  registerAuthAndProfileHandlers(services, getSock, waConnectionManager)
  registerSearchAndVectorHandlers(services, getSock)
  registerAIServiceHandlers(services, getSock)
  registerAIChatSessionHandlers(services)
  registerNotificationHandlers(services, getSock)
}

function registerChatAndMessageHandlers(
  services: ServiceContainer,
  getSock: () => WASocket | null
): void {
  ipcMain.handle('get-chats', async (_event, page: number = 1, pageSize: number = 50): Promise<ChatListItem[]> => {
    const list = await services.chatService.getChatList(page, pageSize)
    return list.map(item => mapChatToListItem(item))
  })

  ipcMain.handle('get-chat', async (_event, jid: string): Promise<ChatListItem | null> => {
    const item = await services.chatService.getChatByJid(jid)
    if (!item) return null
    return mapChatToListItem(item)
  })

  ipcMain.handle('get-messages', async (_event, jid: string, page: number = 1, pageSize: number = 50) => {
    return services.messageQueryService.getChatMessages(jid, page, pageSize, getSock())
  })

  ipcMain.handle('get-messages-around', async (_event, jid: string, messageId: string, lookBehind: number = 20) => {
    return services.messageQueryService.getMessagesAroundId(jid, messageId, lookBehind, getSock())
  })

  ipcMain.handle('send-message', async (_event, jid: string, text: string, quotedMsgId?: string, mentions?: string[]) => {
    const sock = getSock()
    if (!sock) throw new Error('[IPC] WhatsApp socket is not connected')
    return services.messageActionService.sendMessageWorkflow(sock, jid, text, quotedMsgId, mentions)
  })

  ipcMain.handle('edit-message', async (_event, jid: string, messageId: string, newText: string) => {
    const sock = getSock()
    if (!sock) throw new Error('[IPC] WhatsApp socket is not connected')
    return await services.messageActionService.editMessage(sock, messageId, newText, jid)
  })

  ipcMain.handle('delete-message', async (_event, jid: string, messageId: string) => {
    const sock = getSock()
    if (!sock) throw new Error('[IPC] WhatsApp socket is not connected')
    await services.messageActionService.deleteMessage(sock, messageId, jid)
    return true
  })

  ipcMain.handle('react-message', async (_event, jid: string, messageId: string, reaction: string) => {
    const sock = getSock()
    if (!sock) throw new Error('[IPC] WhatsApp socket is not connected')
    return await services.messageActionService.reactToMessage(sock, messageId, reaction, jid)
  })

  ipcMain.handle('send-media-message', async (_event, jid: string, filePath: string, caption?: string, quotedMsgId?: string, mentions?: string[]) => {
    const sock = getSock()
    if (!sock) throw new Error('[IPC] WhatsApp socket is not connected')
    return services.messageActionService.sendMediaMessageWorkflow(sock, jid, filePath, caption, quotedMsgId, mentions)
  })

  ipcMain.handle('mark-read', async (_event, jid: string) => {
    return services.chatService.markRead(jid)
  })

  ipcMain.handle('mute-chat', async (_event, jid: string, durationMs: number) => {
    const sock = getSock()
    if (!sock) throw new Error('[IPC] WhatsApp socket is not connected')
    await services.chatActionService.muteChat(sock, jid, durationMs)
    return true
  })

  ipcMain.handle('unmute-chat', async (_event, jid: string) => {
    const sock = getSock()
    if (!sock) throw new Error('[IPC] WhatsApp socket is not connected')
    await services.chatActionService.muteChat(sock, jid, null)
    return true
  })

  ipcMain.handle('pin-chat', async (_event, jid: string) => {
    const sock = getSock()
    if (!sock) throw new Error('[IPC] WhatsApp socket is not connected')
    await services.chatActionService.pinChat(sock, jid, true)
    return true
  })

  ipcMain.handle('unpin-chat', async (_event, jid: string) => {
    const sock = getSock()
    if (!sock) throw new Error('[IPC] WhatsApp socket is not connected')
    await services.chatActionService.pinChat(sock, jid, false)
    return true
  })
}

function mapChatToListItem(item: ChatListItem): ChatListItem {
  return {
    jid: item.jid,
    name: item.name,
    unreadCount: item.unreadCount,
    timestamp: item.timestamp,
    lastMessage: item.lastMessage,
    lastMessageType: item.lastMessageType,
    lastMessageTimestamp: item.lastMessageTimestamp,
    pinned: item.pinned,
    muteExpiration: item.muteExpiration,
    profilePictureUrl: item.profilePictureUrl,
    isCommunity: item.isCommunity,
    isAnnounce: item.isAnnounce,
    linkedParentJid: item.linkedParentJid,
    lastMessageSender: item.lastMessageSender,
    lastMessageStatus: item.lastMessageStatus,
    lastMessageFromMe: item.lastMessageFromMe,
    lastMessageId: item.lastMessageId,
    lastMessageTargetType: item.lastMessageTargetType,
    lastMessageTargetText: item.lastMessageTargetText,
    lastMessageReactionText: item.lastMessageReactionText
  }
}

function registerMediaAndFileHandlers(
  services: ServiceContainer,
  getSock: () => WASocket | null,
  secureRegistry: ISecureFileRegistry
): void {
  ipcMain.handle('save-temp-file', async (event, buffer: Buffer | ArrayBuffer | Uint8Array, fileName: string) => {
    if (!isTrustedSender(event)) throw new Error('[IPC] save-temp-file cannot be invoked from this context')
    const tempDir = join(app.getPath('userData'), DIR_NAME_TEMP)
    if (!fs.existsSync(tempDir)) fs.mkdirSync(tempDir, { recursive: true })

    const filePath = resolveInsideDir(tempDir, fileName)
    const data = buffer instanceof Uint8Array ? buffer : Buffer.from(buffer)
    fs.writeFileSync(filePath, data)

    if (fileName.startsWith(PREFIX_VOICE) && fileName.endsWith(EXT_OGG)) {
      return audioTranscoderService.transcodeToWAPtt(filePath, tempDir)
    }

    return filePath
  })

  ipcMain.handle('download-url-to-temp', async (event, url: string, fileName: string) => {
    if (!isTrustedSender(event)) throw new Error('[IPC] download-url-to-temp cannot be invoked from this context')

    let parsed: URL
    try {
      parsed = new URL(url)
    } catch {
      throw new Error('[IPC] download-url-to-temp: invalid URL')
    }
    if (!ALLOWED_DOWNLOAD_PROTOCOLS.has(parsed.protocol)) {
      throw new Error(`[IPC] download-url-to-temp: unsupported protocol '${parsed.protocol}'`)
    }

    const tempDir = join(app.getPath('userData'), DIR_NAME_TEMP)
    if (!fs.existsSync(tempDir)) fs.mkdirSync(tempDir, { recursive: true })

    const filePath = resolveInsideDir(tempDir, fileName)

    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), DOWNLOAD_TIMEOUT_MS)
    const fileStream = fs.createWriteStream(filePath)
    try {
      const response = await fetch(url, { signal: controller.signal })
      if (!response.ok) throw new Error(`[IPC] Failed to download file: ${response.statusText}`)

      const declaredLength = Number(response.headers.get('content-length') || 0)
      if (declaredLength > MAX_DOWNLOAD_BYTES) {
        throw new Error('[IPC] download-url-to-temp: response exceeds size cap')
      }
      if (!response.body) throw new Error('[IPC] download-url-to-temp: empty response body')

      let total = 0
      for await (const chunk of response.body as unknown as AsyncIterable<Uint8Array>) {
        total += chunk.length
        if (total > MAX_DOWNLOAD_BYTES) {
          throw new Error('[IPC] download-url-to-temp: response exceeds size cap')
        }
        if (!fileStream.write(Buffer.from(chunk))) {
          await new Promise<void>((res) => fileStream.once('drain', res))
        }
      }
      await new Promise<void>((res, rej) => fileStream.end((err?: Error | null) => (err ? rej(err) : res())))
      return filePath
    } catch (err) {
      fileStream.destroy()
      fs.rmSync(filePath, { force: true })
      throw err
    } finally {
      clearTimeout(timeout)
    }
  })

  ipcMain.on('grant-local-file-preview', (event, filePath: unknown) => {
    // S10-01: the grant itself is the LFI trust boundary (S12-01) — only the
    // top-level app renderer may register a path for app://local resolution.
    if (!isTrustedSender(event)) {
      console.warn('[IPC] Blocked grant-local-file-preview from untrusted frame')
      return
    }
    if (typeof filePath === 'string' && filePath.length > 0) {
      secureRegistry.grantFile(filePath)
    }
  })

  ipcMain.handle('select-file', async () => {
    const win = BrowserWindow.getFocusedWindow()
    const { canceled, filePaths } = await dialog.showOpenDialog(win!, {
      properties: ['openFile', 'multiSelections'],
      filters: [{ name: 'All Files', extensions: ['*'] }]
    })
    if (canceled || filePaths.length === 0) return null
    // Grant read access so the renderer can preview these exact files via
    // app://local/<path> before sending. Nothing else can reach app://local.
    for (const p of filePaths) secureRegistry.grantFile(p)
    return filePaths
  })

  ipcMain.handle('download-media', async (_event, msgId: string) => {
    const sock = getSock()
    return services.mediaService.downloadAndCacheMedia(msgId, sock)
  })

  ipcMain.handle('open-file', async (_event, localURI: string) => {
    return services.mediaService.openFile(localURI)
  })
}

function registerStickerHandlers(services: ServiceContainer): void {
  ipcMain.handle('add-sticker-to-favorites', async (_event, msgId: string) => {
    return services.favoriteStickerService.addStickerToFavorites(msgId)
  })

  ipcMain.handle('remove-sticker-from-favorites', async (_event, msgId: string) => {
    return services.favoriteStickerService.removeStickerFromFavorites(msgId)
  })

  ipcMain.handle('remove-favorite-sticker-by-id', async (_event, id: string) => {
    return services.favoriteStickerService.removeFavoriteStickerById(id)
  })

  ipcMain.handle('is-sticker-favorite', async (_event, msgId: string) => {
    return services.favoriteStickerService.isStickerFavorite(msgId)
  })

  ipcMain.handle('get-favorite-stickers', async () => {
    return services.favoriteStickerService.getFavoriteStickers()
  })
}

function registerAuthAndProfileHandlers(
  services: ServiceContainer,
  getSock: () => WASocket | null,
  waConnectionManager: WhatsAppConnectionManager
): void {
  ipcMain.handle('get-my-jid', async () => {
    return services.contactService.getMePhoneNumberJid(getSock())
  })

  ipcMain.handle('logout', async (event) => {
    // S10-06: `logout` unlinks the device AND wipes all local data. Only the
    // trusted app renderer may trigger it — not a <webview>/sub-frame.
    if (!isTrustedSender(event)) {
      console.warn('[IPC] Blocked logout from untrusted frame')
      throw new Error('[IPC] logout cannot be invoked from this context')
    }
    const sock = getSock()
    if (sock) await sock.logout().catch((err: unknown) => { console.warn('[IPC] sock.logout failed:', err) })
    // wipeAllData throws on a partial wipe — let it reject so the renderer keeps
    // the user on the current screen instead of reloading into a half-wiped DB.
    await services.dataWipeService.wipeAllData()
    return true
  })

  ipcMain.handle('get-profile-picture', async (_event, jid: string, type: 'preview' | 'image' = 'preview', forceRefresh: boolean = false) => {
    const sock = getSock()
    return services.profileSyncService.getProfilePicture(jid, type, sock, forceRefresh)
  })

  ipcMain.handle('get-group-participants', async (_event, jid: string) => {
    return services.chatService.getGroupParticipants(jid)
  })

  ipcMain.handle('get-sync-full-history', async () => {
    return services.authSettingsService.getSyncFullHistory()
  })

  ipcMain.handle('set-sync-full-history', async (event, full: boolean) => {
    if (!isTrustedSender(event)) {
      console.warn('[IPC] Blocked set-sync-full-history from untrusted frame')
      throw new Error('[IPC] set-sync-full-history cannot be invoked from this context')
    }
    await services.authSettingsService.setSyncFullHistory(full)
    // S10-09 / S3-04: don't leave connect() as a floating promise — a rejection
    // here (wipeAllData, hasCreds, getHistorySyncCompleted) would otherwise be an
    // unhandled rejection with the renderer told the change succeeded.
    try {
      await waConnectionManager.connect()
    } catch (err: unknown) {
      console.error('[IPC] set-sync-full-history reconnect failed:', err)
    }
    return true
  })
}

function registerSearchAndVectorHandlers(
  services: ServiceContainer,
  getSock: () => WASocket | null
): void {
  ipcMain.handle('search-all', async (_event, query: string, mode: 'normal' | 'deep' = 'normal', filters?: { jids?: string[], fromDate?: string, toDate?: string }) => {
    const sock = getSock()
    const parsedFilters = filters ? {
      jids: filters.jids,
      fromDate: filters.fromDate ? new Date(filters.fromDate) : undefined,
      toDate: filters.toDate ? new Date(filters.toDate) : undefined
    } : undefined
    return services.searchService.searchAll(query, mode, sock, parsedFilters)
  })

  ipcMain.handle('search-mention-contacts', async (_event, query: string) => {
    return services.searchService.searchMentionContacts(query)
  })

  ipcMain.handle('search-mention-chats', async (_event, query: string) => {
    return services.searchService.searchMentionChats(query)
  })

  ipcMain.handle('index-embeddings', async (_event) => {
    const win = BrowserWindow.getAllWindows()[0]
    try {
      await services.embeddingService.indexAll((pct) => {
        win?.webContents.send(EVENT_EMBEDDING_PROGRESS, pct)
      })
      win?.webContents.send(EVENT_EMBEDDING_PROGRESS, 100)
    } catch (err) {
      console.error('[IPC] index-embeddings failed:', err)
    }
  })

  ipcMain.handle('clear-vectors', async (event) => {
    if (!isTrustedSender(event)) {
      console.warn('[IPC] Blocked clear-vectors from untrusted frame')
      throw new Error('[IPC] clear-vectors cannot be invoked from this context')
    }
    try {
      await services.embeddingService.clearAllVectors()
    } catch (err: unknown) {
      console.error('[IPC] Failed to clear vectors:', err)
    }
  })
}

function registerAIServiceHandlers(
  services: ServiceContainer,
  getSock: () => WASocket | null
): void {
  AIToolInitializer.initializeAll(getSock, services);

  services.embeddingService.setOnActiveStateSync((isActive) => {
    BrowserWindow.getAllWindows().forEach(win => {
      win.webContents.send(EVENT_EMBEDDING_STATE, isActive)
    })
  })

  ipcMain.handle('execute-tool', async (event, toolName: string, args: Record<string, unknown> | undefined, sessionId?: string | null) => {
    const tool = services.toolRegistry.getTool(toolName);
    if (!tool) throw new Error(`[IPC] Tool ${toolName} not found`);
    // S10-05: permission-gated tools (send-as-user, arbitrary SQL/script) may
    // only be driven from the trusted app renderer, which prompts the user
    // before calling. Reject the call from any other frame and audit-log it.
    if (tool.requiresPermission && !isTrustedSender(event)) {
      console.warn(`[IPC] Blocked execute-tool('${toolName}') from untrusted frame`);
      throw new Error(`[IPC] Tool ${toolName} requires permission and cannot be invoked from this context`);
    }
    if (tool.requiresPermission) {
      // S10-07: don't trust the renderer's "user approved" assertion — a
      // compromised (XSS'd) trusted renderer would still pass isTrustedSender.
      // Confirm consent in the main process before running host-capable tools.
      console.log(`[IPC] execute-tool('${toolName}') (permission-gated) invoked`);
      const win = BrowserWindow.fromWebContents(event.sender) ?? BrowserWindow.getFocusedWindow();
      const { response } = await dialog.showMessageBox(win!, {
        type: 'warning',
        buttons: ['Cancel', 'Allow'],
        defaultId: 0,
        cancelId: 0,
        title: 'Permission required',
        message: `Allow the assistant to run "${tool.name}"?`,
        detail: tool.description || 'This tool can act on your behalf or access local data.'
      });
      if (response !== 1) {
        throw new Error(`[IPC] Tool ${toolName} was not approved by the user`);
      }
    }
    const ctx = sessionId ? { citationEmitter: await services.citationSessionManager.createEmitter(sessionId) } : undefined;
    const result = await tool.execute(args || {}, ctx);
    if (sessionId && result.citations && result.citations.size > 0) {
      await services.citationSessionManager.persist(sessionId, result.citations);
    }
    return result;
  });

  ipcMain.handle('get-ai-tools', async () => {
    return services.toolRegistry.getAllTools().map(t => ({
      name: t.name,
      description: t.description,
      requiresPermission: t.requiresPermission
    }));
  });

  ipcMain.handle(
    'ai-chat',
    async (
      _event,
      prompt: string,
      contextChats?: AIChatContext[],
      history?: AIHistoryMessage[],
      mentions?: AIMention[],
      options?: { model?: string; useThinkMode?: boolean; isSystem?: boolean; requestId?: string; contextLength?: number }
    ) => {
      // S6-02: the user-configurable context length only affects local (LM Studio)
      // models and is not carried in `options` from the renderer — source it from
      // the persisted AI preferences here so the knob actually takes effect.
      const aiOptions = await services.aiChatSessionService.getAIOptions();
      return await services.aiService.generateResponse(prompt, contextChats, history, mentions, {
        contextLength: aiOptions.contextLength,
        ...options
      });
    }
  )

  ipcMain.handle('get-ai-models', async () => {
    return await services.aiService.getAvailableModels();
  })

  ipcMain.handle('get-provider-keys', async (event) => {
    // S10-02: returns plaintext provider API keys — trusted app renderer only.
    if (!isTrustedSender(event)) {
      console.warn('[IPC] Blocked get-provider-keys from untrusted frame')
      throw new Error('[IPC] get-provider-keys cannot be invoked from this context')
    }
    return services.aiService.getProviderKeys();
  })

  ipcMain.handle('set-provider-key', async (event, provider: string, key: string) => {
    // S10-02: overwrites a stored key and hot-swaps the live provider — trusted
    // app renderer only, else an untrusted frame can MITM all AI traffic.
    if (!isTrustedSender(event)) {
      console.warn('[IPC] Blocked set-provider-key from untrusted frame')
      throw new Error('[IPC] set-provider-key cannot be invoked from this context')
    }
    return services.aiService.setProviderKey(provider, key);
  })

  ipcMain.on('ai-chat-stream', async (event, args: {
    channelId: string;
    prompt: string;
    contextChats?: AIChatContext[];
    history?: AIHistoryMessage[];
    mentions?: AIMention[];
    options?: { model?: string; useThinkMode?: boolean; isSystem?: boolean; requestId?: string; contextLength?: number };
  }) => {
    const { channelId, prompt, contextChats, history, mentions, options } = args;
    try {
      // S6-02: carry the persisted context-length preference through to the provider.
      const aiOptions = await services.aiChatSessionService.getAIOptions();
      await services.aiService.generateResponseStream(
        prompt,
        contextChats,
        history,
        mentions,
        { contextLength: aiOptions.contextLength, ...options, requestId: channelId },
        (chunk) => {
          event.sender.send(`${channelId}-chunk`, chunk);
        }
      );
      event.sender.send(`${channelId}-end`);
    } catch (err) {
      const errorVal = err as Error;
      if (errorVal.name === 'AbortError' || errorVal.message?.includes('abort')) {
        event.sender.send(`${channelId}-end`);
      } else {
        event.sender.send(`${channelId}-error`, errorVal.message || String(errorVal));
      }
    }
  });

  ipcMain.handle('abort-ai-chat', async (_event, requestId: string) => {
    services.aiService.abortResponse(requestId);
    return true;
  });

  ipcMain.handle('get-chat-context', async (_event, jid: string) => {
    return services.messageQueryService.getChatMessages(jid, 1, 100, getSock(), true, false)
  })
}

function registerAIChatSessionHandlers(services: ServiceContainer): void {
  ipcMain.handle('ai-session-create', async (_event, title: string, modelId?: string) => {
    return await services.aiChatSessionService.createSession(title, modelId);
  });

  ipcMain.handle('ai-session-list', async (_event, page?: number, pageSize?: number) => {
    return await services.aiChatSessionService.listSessions(page, pageSize);
  });

  ipcMain.handle('ai-session-get', async (_event, id: string) => {
    return await services.aiChatSessionService.getSession(id);
  });

  ipcMain.handle('ai-session-rename', async (_event, id: string, title: string) => {
    return await services.aiChatSessionService.renameSession(id, title);
  });

  ipcMain.handle('ai-session-delete', async (_event, id: string) => {
    return await services.aiChatSessionService.deleteSession(id);
  });

  ipcMain.handle('ai-session-clone', async (_event, id: string) => {
    return await services.aiChatSessionService.cloneSession(id);
  });

  ipcMain.handle('ai-session-save-messages', async (_event, sessionId: string, messages: AIChatMessageInput[]) => {
    return await services.aiChatSessionService.saveMessages(sessionId, messages);
  });

  ipcMain.handle('ai-session-get-autosave', async () => {
    return await services.aiChatSessionService.getAutoSavePreference();
  });

  ipcMain.handle('ai-session-set-autosave', async (_event, enabled: boolean) => {
    return await services.aiChatSessionService.setAutoSavePreference(enabled);
  });

  ipcMain.handle('get-ai-options', async () => {
    return await services.aiChatSessionService.getAIOptions();
  });

  ipcMain.handle('set-ai-options', async (_event, options: Record<string, unknown>) => {
    return await services.aiChatSessionService.setAIOptions(options);
  });

  ipcMain.handle('export-ai-chat', async (_event, session: ExportSession, messages: ExportMessage[]) => {
    return await services.aiChatExportService.exportChat(session, messages)
  })

  ipcMain.handle('delete-exported-ai-chat', async (_event, sessionId: string) => {
    return await services.aiChatExportService.deleteExportedChat(sessionId)
  })

  ipcMain.handle('duplicate-exported-ai-chat', async (_event, sessionId: string) => {
    return await services.aiChatExportService.duplicateExportedChat(sessionId)
  })

  ipcMain.handle('citation:resolve', async (_event, sessionId: string, citationIndex: number) => {
    return await services.citationSessionManager.resolve(sessionId, citationIndex);
  });

  ipcMain.handle('citation:resolveAll', async (_event, sessionId: string) => {
    return await services.citationSessionManager.resolveAll(sessionId);
  });
}

function registerNotificationHandlers(
  services: ServiceContainer,
  getSock: () => WASocket | null
): void {
  ipcMain.handle('get-message-receipts', async (_event, messageId: string) => {
    return services.receiptService.getMessageReceipts(messageId, getSock())
  })

  ipcMain.handle('get-notification-preferences', async () => {
    return services.notificationService.getPreferences()
  })

  ipcMain.handle('set-notification-preferences', async (_event, prefs: Partial<NotificationPreferences>) => {
    return services.notificationService.setPreferences(prefs)
  })

  ipcMain.handle('set-active-chat', async (_event, jid: string | null) => {
    services.notificationService.setActiveChat(jid)
  })
}
