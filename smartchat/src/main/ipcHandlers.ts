import { ipcMain, app, dialog, BrowserWindow } from 'electron'
import { PrismaClient } from '@prisma/client'
import fs from 'fs'
import { join } from 'path'
import { ServiceContainer } from './ServiceContainer'
import { toolRegistry } from './services/ai/AIToolService'
import { AIToolInitializer } from './services/ai/AIToolInitializer'
import { audioTranscoderService } from './services/audio/AudioTranscoderService'
import { WASocket } from './types'
import { WhatsAppConnectionManager } from './services/whatsapp'

export function registerIpcHandlers(
  prisma: PrismaClient,
  services: ServiceContainer,
  getSock: () => WASocket | null,
  waConnectionManager: WhatsAppConnectionManager
): void {
  // ── Get Chat List (paginated, sorted by latest timestamp) ────────────
  ipcMain.handle('get-chats', async (_event, page: number = 1, pageSize: number = 50) => {
    return services.chatService.getChatList(page, pageSize)
  })

  // ── Get Messages for a Chat (paginated) ──────────────────────────────
  ipcMain.handle(
    'get-messages',
    async (_event, jid: string, page: number = 1, pageSize: number = 50) => {
      return services.messageService.getChatMessages(jid, page, pageSize, getSock())
    }
  )

  // ── Send Message ─────────────────────────────────────────────────────
  ipcMain.handle('send-message', async (_event, jid: string, text: string, quotedMsgId?: string, mentions?: string[]) => {
    const sock = getSock()
    if (!sock) throw new Error('WhatsApp socket is not connected')
    return services.messageActionService.sendMessageWorkflow(sock, jid, text, quotedMsgId, mentions)
  })

  // ── Edit Message ─────────────────────────────────────────────────────
  ipcMain.handle('edit-message', async (_event, jid: string, messageId: string, newText: string) => {
    const sock = getSock()
    if (!sock) throw new Error('WhatsApp socket is not connected')
    return await services.messageActionService.editMessage(sock, messageId, newText, jid)
  })

  // ── Delete Message ───────────────────────────────────────────────────
  ipcMain.handle('delete-message', async (_event, jid: string, messageId: string) => {
    const sock = getSock()
    if (!sock) throw new Error('WhatsApp socket is not connected')
    await services.messageActionService.deleteMessage(sock, messageId, jid)
    return true
  })

  // ── React Message ────────────────────────────────────────────────────
  ipcMain.handle('react-message', async (_event, jid: string, messageId: string, reaction: string) => {
    const sock = getSock()
    if (!sock) throw new Error('WhatsApp socket is not connected')
    return await services.messageActionService.reactToMessage(sock, messageId, reaction, jid)
  })

  // ── Send Media Message ───────────────────────────────────────────────
  ipcMain.handle('send-media-message', async (_event, jid: string, filePath: string, caption?: string, quotedMsgId?: string, mentions?: string[]) => {
    const sock = getSock()
    if (!sock) throw new Error('WhatsApp socket is not connected')
    return services.messageActionService.sendMediaMessageWorkflow(sock, jid, filePath, caption, quotedMsgId, mentions)
  })

  // ── Save Temp File ───────────────────────────────────────────────────
  ipcMain.handle('save-temp-file', async (_event, buffer: Buffer | ArrayBuffer | Uint8Array, fileName: string) => {
    const tempDir = join(app.getPath('userData'), 'temp')
    if (!fs.existsSync(tempDir)) fs.mkdirSync(tempDir, { recursive: true })

    const filePath = join(tempDir, fileName)
    const data = buffer instanceof Uint8Array ? buffer : Buffer.from(buffer as any)
    fs.writeFileSync(filePath, data)

    if (fileName.startsWith('voice_') && fileName.endsWith('.ogg')) {
      return audioTranscoderService.transcodeToWAPtt(filePath, tempDir)
    }

    return filePath
  })

  // ── Download URL to Temp ─────────────────────────────────────────────
  ipcMain.handle('download-url-to-temp', async (_event, url: string, fileName: string) => {
    const tempDir = join(app.getPath('userData'), 'temp')
    if (!fs.existsSync(tempDir)) fs.mkdirSync(tempDir, { recursive: true })

    const filePath = join(tempDir, fileName)
    const response = await fetch(url)
    if (!response.ok) throw new Error(`Failed to download file: ${response.statusText}`)
    
    const arrayBuffer = await response.arrayBuffer()
    fs.writeFileSync(filePath, Buffer.from(arrayBuffer))
    return filePath
  })

  // ── Mark Chat as Read ───────────────────────────────────────────────
  ipcMain.handle('mark-read', async (_event, jid: string) => {
    return services.chatService.markRead(jid)
  })

  // ── Get My JID ───────────────────────────────────────────────────────
  ipcMain.handle('get-my-jid', async () => {
    const me = await prisma.identity.findFirst({ where: { isMe: true } })
    if (me) return me.phoneNumber
    const rawJid = getSock()?.user?.id
    return rawJid ? rawJid.split(':')[0] + '@s.whatsapp.net' : null
  })

  // ── Select File Dialog ───────────────────────────────────────────────
  ipcMain.handle('select-file', async () => {
    const win = BrowserWindow.getFocusedWindow()
    const { canceled, filePaths } = await dialog.showOpenDialog(win!, {
      properties: ['openFile'],
      filters: [{ name: 'All Files', extensions: ['*'] }]
    })
    return (canceled || filePaths.length === 0) ? null : filePaths[0]
  })

  // ── Download Media ───────────────────────────────────────────────────
  ipcMain.handle('download-media', async (_event, msgId: string) => {
    const sock = getSock()
    return services.mediaService.downloadAndCacheMedia(msgId, sock)
  })

  // ── Open File with System Default ──────────────────────────────────
  ipcMain.handle('open-file', async (_event, localURI: string) => {
    return services.mediaService.openFile(localURI)
  })

  // ── Logout ──────────────────────────────────────────────────────────
  ipcMain.handle('logout', async () => {
    const sock = getSock()
    if (sock) await sock.logout().catch(() => { })
    await services.dataWipeService.wipeAllData()
    return true
  })

  // ── Get Profile Picture ─────────────────────────────────────────────
  ipcMain.handle('get-profile-picture', async (_event, jid: string, type: 'preview' | 'image' = 'preview', forceRefresh: boolean = false) => {
    const sock = getSock()
    return services.contactService.getProfilePicture(jid, type, sock, forceRefresh)
  })

  // ── Get Group Participants ────────────────────────────────────────────
  ipcMain.handle('get-group-participants', async (_event, jid: string) => {
    const sock = getSock()
    return services.chatService.getGroupParticipants(jid, sock)
  })

  // ── Global Search ────────────────────────────────────────────────────
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

  // ── Sync Mode Configuration ─────────────────────────────────────────
  ipcMain.handle('get-sync-full-history', async () => {
    const row = await prisma.authState.findUnique({ where: { id: 'sync_full_history' } }).catch(() => null)
    return row?.data === 'true'
  })

  ipcMain.handle('set-sync-full-history', async (_event, full: boolean) => {
    await prisma.authState.upsert({
      where: { id: 'sync_full_history' },
      update: { data: full ? 'true' : 'false' },
      create: { id: 'sync_full_history', data: full ? 'true' : 'false' }
    }).catch(() => { })

    waConnectionManager.connect()
    return true
  })

  // ── Index Embeddings ────────────────────────────────────────────────
  ipcMain.handle('index-embeddings', async (_event) => {
    const win = BrowserWindow.getAllWindows()[0]
    try {
      await services.embeddingService.indexAll((pct) => {
        win?.webContents.send('embedding-progress', pct)
      })
      win?.webContents.send('embedding-progress', 100)
    } catch (err) {
      console.error('[IPC] index-embeddings failed:', err)
    }
  })

  ipcMain.handle('clear-vectors', async (_event) => {
    try {
      await services.embeddingService.clearAllVectors()
    } catch (err) { }
  })

  // ── AI Handlers ───────────────────────────────────────────────────────

  AIToolInitializer.initializeAll(getSock, services);

  services.embeddingService.setOnActiveStateSync((isActive) => {
    BrowserWindow.getAllWindows().forEach(win => {
      win.webContents.send('embedding-state', isActive)
    })
  })

  ipcMain.handle('execute-tool', async (_event, toolName: string, args: any) => {
    const tool = toolRegistry.getTool(toolName);
    if (!tool) throw new Error(`Tool ${toolName} not found`);
    return await tool.execute(args || {});
  });

  ipcMain.handle('get-ai-tools', async () => {
    return toolRegistry.getAllTools().map(t => ({
      name: t.name,
      description: t.description,
      requiresPermission: t.requiresPermission
    }));
  });

  ipcMain.handle('ai-chat', async (_event, prompt: string, contextChats?: any[], history?: any[], mentions?: any[], options?: any) => {
    return await services.aiService.generateResponse(prompt, contextChats, history, mentions, options);
  })

  ipcMain.handle('get-ai-models', async () => {
    return await services.aiService.getAvailableModels();
  })

  ipcMain.handle('get-provider-keys', async () => {
    return services.aiService.getProviderKeys();
  })

  ipcMain.handle('set-provider-key', async (_event, provider: string, key: string) => {
    return services.aiService.setProviderKey(provider, key);
  })

  ipcMain.on('ai-chat-stream', async (event, args) => {
    const { channelId, prompt, contextChats, history, mentions, options } = args;
    try {
      await services.aiService.generateResponseStream(prompt, contextChats, history, mentions, { ...options, requestId: channelId }, (chunk) => {
        event.sender.send(`${channelId}-chunk`, chunk);
      });
      event.sender.send(`${channelId}-end`);
    } catch (err: any) {
      if (err.name === 'AbortError' || err.message?.includes('abort')) {
        event.sender.send(`${channelId}-end`); // Treat abort as normal end for the frontend
      } else {
        event.sender.send(`${channelId}-error`, err.message || String(err));
      }
    }
  });

  ipcMain.handle('abort-ai-chat', async (_event, requestId: string) => {
    services.aiService.abortResponse(requestId);
    return true;
  });

  ipcMain.handle('get-chat-context', async (_event, jid: string) => {
    return services.messageService.getChatMessages(jid, 1, 100, getSock(), true, false)
  })

  // ── AI Chat Session Handlers ─────────────────────────────────────────
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

  ipcMain.handle('ai-session-save-messages', async (_event, sessionId: string, messages: any[]) => {
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

  ipcMain.handle('set-ai-options', async (_event, options: any) => {
    return await services.aiChatSessionService.setAIOptions(options);
  });

  ipcMain.handle('export-ai-chat', async (_event, session: any, messages: any[]) => {
    return await services.aiChatExportService.exportChat(session, messages)
  })

  ipcMain.handle('delete-exported-ai-chat', async (_event, sessionId: string) => {
    return await services.aiChatExportService.deleteExportedChat(sessionId)
  })

  ipcMain.handle('duplicate-exported-ai-chat', async (_event, sessionId: string) => {
    return await services.aiChatExportService.duplicateExportedChat(sessionId)
  })

  ipcMain.handle('get-message-receipts', async (_event, messageId: string) => {
    return services.receiptService.getMessageReceipts(messageId, getSock())
  })
}
