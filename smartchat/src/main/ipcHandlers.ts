import { ipcMain, app, dialog, BrowserWindow } from 'electron'
import fs from 'fs'
import { join } from 'path'
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

const DIR_NAME_TEMP = 'temp'
const PREFIX_VOICE = 'voice_'
const EXT_OGG = '.ogg'
const EVENT_EMBEDDING_PROGRESS = 'embedding-progress'
const EVENT_EMBEDDING_STATE = 'embedding-state'

export function registerIpcHandlers(
  services: ServiceContainer,
  getSock: () => WASocket | null,
  waConnectionManager: WhatsAppConnectionManager
): void {
  registerChatAndMessageHandlers(services, getSock)
  registerMediaAndFileHandlers(services, getSock)
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
    await sock.chatModify({ mute: durationMs }, jid)
    return true
  })

  ipcMain.handle('unmute-chat', async (_event, jid: string) => {
    const sock = getSock()
    if (!sock) throw new Error('[IPC] WhatsApp socket is not connected')
    await sock.chatModify({ mute: null }, jid)
    return true
  })

  ipcMain.handle('pin-chat', async (_event, jid: string) => {
    const sock = getSock()
    if (!sock) throw new Error('[IPC] WhatsApp socket is not connected')
    await sock.chatModify({ pin: true }, jid)
    return true
  })

  ipcMain.handle('unpin-chat', async (_event, jid: string) => {
    const sock = getSock()
    if (!sock) throw new Error('[IPC] WhatsApp socket is not connected')
    await sock.chatModify({ pin: false }, jid)
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
  getSock: () => WASocket | null
): void {
  ipcMain.handle('save-temp-file', async (_event, buffer: Buffer | ArrayBuffer | Uint8Array, fileName: string) => {
    const tempDir = join(app.getPath('userData'), DIR_NAME_TEMP)
    if (!fs.existsSync(tempDir)) fs.mkdirSync(tempDir, { recursive: true })

    const filePath = join(tempDir, fileName)
    const data = buffer instanceof Uint8Array ? buffer : Buffer.from(buffer)
    fs.writeFileSync(filePath, data)

    if (fileName.startsWith(PREFIX_VOICE) && fileName.endsWith(EXT_OGG)) {
      return audioTranscoderService.transcodeToWAPtt(filePath, tempDir)
    }

    return filePath
  })

  ipcMain.handle('download-url-to-temp', async (_event, url: string, fileName: string) => {
    const tempDir = join(app.getPath('userData'), DIR_NAME_TEMP)
    if (!fs.existsSync(tempDir)) fs.mkdirSync(tempDir, { recursive: true })

    const filePath = join(tempDir, fileName)
    const response = await fetch(url)
    if (!response.ok) throw new Error(`[IPC] Failed to download file: ${response.statusText}`)
    
    const arrayBuffer = await response.arrayBuffer()
    fs.writeFileSync(filePath, Buffer.from(arrayBuffer))
    return filePath
  })

  ipcMain.handle('select-file', async () => {
    const win = BrowserWindow.getFocusedWindow()
    const { canceled, filePaths } = await dialog.showOpenDialog(win!, {
      properties: ['openFile', 'multiSelections'],
      filters: [{ name: 'All Files', extensions: ['*'] }]
    })
    return (canceled || filePaths.length === 0) ? null : filePaths
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

  ipcMain.handle('logout', async () => {
    const sock = getSock()
    if (sock) await sock.logout().catch((err: unknown) => { console.warn('[IPC] sock.logout failed:', err) })
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

  ipcMain.handle('set-sync-full-history', async (_event, full: boolean) => {
    await services.authSettingsService.setSyncFullHistory(full)
    waConnectionManager.connect()
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

  ipcMain.handle('clear-vectors', async (_event) => {
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

  ipcMain.handle('execute-tool', async (_event, toolName: string, args: Record<string, unknown> | undefined) => {
    const tool = services.toolRegistry.getTool(toolName);
    if (!tool) throw new Error(`[IPC] Tool ${toolName} not found`);
    return await tool.execute(args || {});
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
      options?: { model?: string; useThinkMode?: boolean; isSystem?: boolean; requestId?: string }
    ) => {
      return await services.aiService.generateResponse(prompt, contextChats, history, mentions, options);
    }
  )

  ipcMain.handle('get-ai-models', async () => {
    return await services.aiService.getAvailableModels();
  })

  ipcMain.handle('get-provider-keys', async () => {
    return services.aiService.getProviderKeys();
  })

  ipcMain.handle('set-provider-key', async (_event, provider: string, key: string) => {
    return services.aiService.setProviderKey(provider, key);
  })

  ipcMain.on('ai-chat-stream', async (event, args: {
    channelId: string;
    prompt: string;
    contextChats?: AIChatContext[];
    history?: AIHistoryMessage[];
    mentions?: AIMention[];
    options?: { model?: string; useThinkMode?: boolean; isSystem?: boolean; requestId?: string };
  }) => {
    const { channelId, prompt, contextChats, history, mentions, options } = args;
    try {
      await services.aiService.generateResponseStream(
        prompt,
        contextChats,
        history,
        mentions,
        { ...options, requestId: channelId },
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
