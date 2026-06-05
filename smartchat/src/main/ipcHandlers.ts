import { ipcMain, app, dialog, BrowserWindow } from 'electron'
import { PrismaClient } from '@prisma/client'
import fs from 'fs'
import { join } from 'path'
import { proto } from '@whiskeysockets/baileys'
import { ServiceContainer } from './ServiceContainer'
import { contactService as globalContactService } from './services/contacts/ContactService'
import { messageService as globalMessageService } from './services/messages/MessageService'
import { toolRegistry } from './services/ai/AIToolService'
import { AIToolInitializer } from './services/ai/AIToolInitializer'
import { audioTranscoderService } from './services/audio/AudioTranscoderService'

export function registerIpcHandlers(
  prisma: PrismaClient,
  services: ServiceContainer,
  getSock: () => ReturnType<typeof import('@whiskeysockets/baileys').default> | null
): void {
  // ── Get Chat List (paginated, sorted by latest timestamp) ────────────
  ipcMain.handle('get-chats', async (_event, page: number = 1, pageSize: number = 50) => {
    return services.chatService.getChatList(page, pageSize)
  })

  // ── Get Messages for a Chat (paginated) ──────────────────────────────
  ipcMain.handle(
    'get-messages',
    async (_event, jid: string, page: number = 1, pageSize: number = 50) => {
      const skip = (page - 1) * pageSize
      const sock = getSock()

      const messages = await prisma.message.findMany({
        where: { chatJid: jid },
        orderBy: { timestamp: 'desc' },
        skip,
        take: pageSize,
        include: { sender: true }
      })

      // We still need to parse contextInfo for mentions
      const additionalJids = new Set<string>()
      messages.forEach(m => {
          try {
              const content = JSON.parse(m.content)
              const unwrapped = services.messageService.unwrapMessage(content)
              const ctx = unwrapped?.extendedTextMessage?.contextInfo || unwrapped?.contextInfo
              if (ctx) {
                  if (ctx.participant) additionalJids.add(ctx.participant)
                  if (ctx.mentionedJid) ctx.mentionedJid.forEach((j: string) => additionalJids.add(j))
                  if (ctx.quotedMessage) {
                      const q = services.messageService.unwrapMessage(ctx.quotedMessage)
                      const qCtx = q?.extendedTextMessage?.contextInfo || q?.contextInfo
                      if (qCtx && qCtx.mentionedJid) qCtx.mentionedJid.forEach((j: string) => additionalJids.add(j))
                  }
              }
          } catch(e) {}
      })

      const nameMap = await services.contactService.batchResolveNames(Array.from(additionalJids), sock)

      const messageIds = messages.map((m) => m.id)
      const allReactions = await prisma.reaction.findMany({
        where: { messageId: { in: messageIds } },
        include: { sender: true }
      })

      const messagesWithNames = await Promise.all(
        messages.map(async (m) => {
          const enriched = await services.messageService.enrichMessage(m, sock, nameMap)
          const msgReactions = allReactions.filter((r) => r.messageId === m.id)
          
          return {
            ...enriched,
            reactions: msgReactions.map((r) => ({ 
              ...r, 
              senderId: r.sender.phoneNumber || '',
              timestamp: r.timestamp.toString(),
              senderName: r.sender.displayName || r.sender.pushName || r.sender.phoneNumber?.split('@')[0] || 'Unknown'
            }))
          }
        })
      )

      return messagesWithNames.reverse()
    }
  )

  // ── Send Message ─────────────────────────────────────────────────────
  ipcMain.handle('send-message', async (_event, jid: string, text: string, quotedMsgId?: string, mentions?: string[]) => {
    const sock = getSock()
    if (!sock) throw new Error('WhatsApp socket is not connected')

    const targetJid = await services.contactService.resolveLidFromJid(jid)

    let quoted: any = undefined
    if (quotedMsgId) {
      const qm = await prisma.message.findUnique({ where: { id: quotedMsgId } })
      if (qm && qm.content) {
        try { 
          quoted = { key: { id: quotedMsgId, remoteJid: qm.chatJid, fromMe: qm.fromMe }, message: proto.Message.fromObject(JSON.parse(qm.content)) }
        } catch (e) {}
      }
    }

    const messageContent: any = { text }
    if (mentions && mentions.length > 0) messageContent.mentions = mentions

    const sentMsg = await sock.sendMessage(targetJid, messageContent, { quoted } as any)
    if (!sentMsg) throw new Error('Failed to send message')

    const processed = await services.messageService.processMessage(sentMsg, sock)
    await services.chatService.updateTimestamp(targetJid, processed.timestamp)

    const nameMap = await services.contactService.batchResolveNames([processed.participant || targetJid, ...(mentions || [])], sock)
    return services.messageService.enrichMessage(processed, sock, nameMap)
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

    const targetJid = await services.contactService.resolveLidFromJid(jid)

    let quoted: any = undefined
    if (quotedMsgId) {
        const qm = await prisma.message.findUnique({ where: { id: quotedMsgId } })
        if (qm && qm.content) {
          try { 
            quoted = { key: { id: quotedMsgId, remoteJid: qm.chatJid, fromMe: qm.fromMe }, message: proto.Message.fromObject(JSON.parse(qm.content)) }
          } catch (e) {}
        }
    }

    const buffer = fs.readFileSync(filePath)
    const sendOptions = services.messageService.getMediaSendOptions(filePath, buffer, caption)
    if (mentions && mentions.length > 0) sendOptions.mentions = mentions

    const sentMsg = await sock.sendMessage(targetJid, sendOptions, { quoted } as any)
    if (!sentMsg) throw new Error('Failed to send media message')

    const processed = await services.messageService.processMessage(sentMsg, sock)
    await services.chatService.updateTimestamp(targetJid, processed.timestamp)
    
    const nameMap = await services.contactService.batchResolveNames([processed.participant || targetJid, ...(mentions || [])], sock)
    return services.messageService.enrichMessage(processed, sock, nameMap)
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

  // ── Mark Chat as Read ───────────────────────────────────────────────
  ipcMain.handle('mark-read', async (_event, jid: string) => {
    return services.chatService.markRead(jid)
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
    if (sock) await sock.logout().catch(() => {})
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
    }).catch(() => {})

    const { waConnectionManager } = await import('./services/whatsapp/WhatsAppConnectionManager')
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
    } catch (err) {}
  })

  // ── AI Handlers ───────────────────────────────────────────────────────
  
  AIToolInitializer.initializeAll(getSock);
  
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
    const targetJid = await services.contactService.resolveLidFromJid(jid)
    const messages = await prisma.message.findMany({
      where: { chatJid: targetJid },
      orderBy: { timestamp: 'desc' },
      take: 100,
      include: { sender: true }
    });
    
    const sock = getSock();
    const nameMap = new Map<string, string>() // fallback map, usually resolved via sender

    const enriched = await Promise.all(
      messages.map(async (m) => await services.messageService.enrichMessage(m, sock, nameMap))
    );
    
    return enriched.reverse();
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
    const receipts = await prisma.messageReceipt.findMany({
      where: { messageId },
      orderBy: { timestamp: 'desc' }
    })
    const sock = getSock()
    const result: any[] = []
    for (const receipt of receipts) {
      const name = await services.contactService.resolveName(receipt.userJid, null, sock)
      result.push({
        userJid: receipt.userJid,
        name,
        status: receipt.status,
        timestamp: receipt.timestamp.toString()
      })
    }
    return result
  })
}

// Exporting helpers for index.ts
export const resolveContactName = (jid: string, chatName: string | null, sock: any) => 
    globalContactService.resolveName(jid, chatName, sock)
export const unwrapMessage = (msg: any) => globalMessageService.unwrapMessage(msg)
