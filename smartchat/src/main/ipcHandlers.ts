import { ipcMain, app, dialog, BrowserWindow, shell } from 'electron'
import { PrismaClient } from '@prisma/client'
import fs from 'fs'
import { join } from 'path'
import { downloadContentFromMessage, proto } from '@whiskeysockets/baileys'
import { contactService } from './services/ContactService'
import { messageService } from './services/MessageService'
import { chatService } from './services/ChatService'
import { searchService } from './services/SearchService'
import { embeddingService } from './services/EmbeddingService'
import { aiService } from './services/AIService'
import { toolRegistry } from './services/AIToolService'
import { AIToolInitializer } from './services/AIToolInitializer'

/**
 * Registers all IPC handlers for chat data, messaging, and identity resolution.
 */
export function registerIpcHandlers(
  prisma: PrismaClient,
  getSock: () => ReturnType<typeof import('@whiskeysockets/baileys').default> | null
): void {
  // ── Get Chat List (paginated, sorted by latest timestamp) ────────────
  ipcMain.handle('get-chats', async (_event, page: number = 1, pageSize: number = 50) => {
    const skip = (page - 1) * pageSize
    const chats = await prisma.chat.findMany({
      orderBy: [
        { pinned: 'desc' },
        { timestamp: 'desc' }
      ],
      skip,
      take: pageSize
    })
    
    const sock = getSock()

    // 1. Collect all JIDs for name resolution
    const jids = chats.map(c => c.jid)
    
    // 2. Resolve all names in one DB query (Fixes N+1)
    const nameMap = await contactService.batchResolveNames(jids, sock)

    const enriched = await Promise.all(
      chats.map(async (chat) => {
        const name = nameMap.get(chat.jid) || chat.name || chat.jid.split('@')[0]

        // Fetch the most recent message for preview
        const lastMsg = await prisma.message.findFirst({
          where: { remoteJid: chat.jid },
          orderBy: { timestamp: 'desc' },
          select: { textContent: true, messageType: true, timestamp: true }
        })

        const effectiveTimestamp = lastMsg?.timestamp ?? chat.timestamp

        return {
          jid: chat.jid,
          name,
          unreadCount: chat.unreadCount,
          timestamp: effectiveTimestamp.toString(),
          lastMessage: lastMsg?.messageType === 'stickerMessage' ? 'Sticker' : 
                       lastMsg?.messageType === 'imageMessage' ? 'Photo' : 
                       lastMsg?.messageType === 'videoMessage' ? 'Video' :
                       lastMsg?.messageType === 'documentMessage' ? 'Document' :
                       (lastMsg?.textContent || (lastMsg?.messageType !== 'unknown' ? `[${lastMsg?.messageType}]` : '')),
          lastMessageTimestamp: effectiveTimestamp.toString(),
          pinned: chat.pinned,
          muteExpiration: chat.muteExpiration.toString(),
          profilePictureUrl: (chat as any).profilePictureUrl
        }
      })
    )

    return enriched
  })

  // ── Get Messages for a Chat (paginated) ──────────────────────────────
  ipcMain.handle(
    'get-messages',
    async (_event, jid: string, page: number = 1, pageSize: number = 50) => {
      const skip = (page - 1) * pageSize
      const sock = getSock()

      const messages = await prisma.message.findMany({
        where: { remoteJid: jid },
        orderBy: { timestamp: 'desc' },
        skip,
        take: pageSize
      })

      // 1. Collect all JIDs for name resolution in this page
      const jids = new Set<string>()
      messages.forEach(m => {
        if (m.participant) jids.add(m.participant)
        jids.add(m.remoteJid)
      })

      // 2. Collect reaction sender IDs
      const messageIds = messages.map((m) => m.id)
      const allReactions = await (prisma as any).reaction.findMany({
        where: { messageId: { in: messageIds } }
      })
      allReactions.forEach((r: any) => jids.add(r.senderId))

      // 3. Add context info (quoted participants and mentions) to resolution set
      messages.forEach(m => {
          try {
              const content = JSON.parse(m.content)
              const unwrapped = messageService.unwrapMessage(content)
              const ctx = unwrapped?.extendedTextMessage?.contextInfo || unwrapped?.contextInfo
              if (ctx) {
                  if (ctx.participant) jids.add(ctx.participant)
                  if (ctx.mentionedJid) ctx.mentionedJid.forEach((j: string) => jids.add(j))
                  if (ctx.quotedMessage) {
                      const q = messageService.unwrapMessage(ctx.quotedMessage)
                      const qCtx = q?.extendedTextMessage?.contextInfo || q?.contextInfo
                      if (qCtx && qCtx.mentionedJid) qCtx.mentionedJid.forEach((j: string) => jids.add(j))
                  }
              }
          } catch(e) {}
      })

      // 4. Resolve all names in bulk (Fixes N+1)
      const nameMap = await contactService.batchResolveNames(Array.from(jids), sock)

      // 5. Enrich messages using service
      const messagesWithNames = await Promise.all(
        messages.map(async (m) => {
          const enriched = await messageService.enrichMessage(m, sock, nameMap)
          const msgReactions = allReactions.filter((r: any) => r.messageId === m.id)
          
          return {
            ...enriched,
            reactions: msgReactions.map((r: any) => ({ 
              ...r, 
              timestamp: r.timestamp.toString(),
              senderName: nameMap.get(r.senderId) || r.senderId.replace(/@.*$/, '')
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

    let quoted: any = undefined
    if (quotedMsgId) {
      const qm = await prisma.message.findUnique({ where: { id: quotedMsgId } })
      if (qm && qm.content) {
        try { 
          quoted = { key: { id: quotedMsgId, remoteJid: jid, fromMe: qm.fromMe }, message: proto.Message.fromObject(JSON.parse(qm.content)) }
        } catch (e) {}
      }
    }

    const messageContent: any = { text }
    if (mentions && mentions.length > 0) messageContent.mentions = mentions

    const sentMsg = await sock.sendMessage(jid, messageContent, { quoted } as any)
    if (!sentMsg) throw new Error('Failed to send message')

    // Persist via Service
    const processed = await messageService.processMessage(sentMsg, sock)
    await chatService.updateTimestamp(jid, processed.timestamp)

    // Enrich for UI
    const nameMap = await contactService.batchResolveNames([processed.participant || jid, ...(mentions || [])], sock)
    return messageService.enrichMessage(processed, sock, nameMap)
  })

  // ── Send Media Message ───────────────────────────────────────────────
  ipcMain.handle('send-media-message', async (_event, jid: string, filePath: string, caption?: string, quotedMsgId?: string, mentions?: string[]) => {
    const sock = getSock()
    if (!sock) throw new Error('WhatsApp socket is not connected')

    let quoted: any = undefined
    if (quotedMsgId) {
        const qm = await prisma.message.findUnique({ where: { id: quotedMsgId } })
        if (qm && qm.content) {
          try { 
            quoted = { key: { id: quotedMsgId, remoteJid: jid, fromMe: qm.fromMe }, message: proto.Message.fromObject(JSON.parse(qm.content)) }
          } catch (e) {}
        }
    }

    const buffer = fs.readFileSync(filePath)
    const sendOptions = messageService.getMediaSendOptions(filePath, buffer, caption)
    if (mentions && mentions.length > 0) sendOptions.mentions = mentions

    const sentMsg = await sock.sendMessage(jid, sendOptions, { quoted } as any)
    if (!sentMsg) throw new Error('Failed to send media message')

    // Persist and enrich
    const processed = await messageService.processMessage(sentMsg, sock)
    await chatService.updateTimestamp(jid, processed.timestamp)
    
    const nameMap = await contactService.batchResolveNames([processed.participant || jid, ...(mentions || [])], sock)
    return messageService.enrichMessage(processed, sock, nameMap)
  })

  // ── Mark Chat as Read ───────────────────────────────────────────────
  ipcMain.handle('mark-read', async (_event, jid: string) => {
    return chatService.markRead(jid)
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
    if (!sock) throw new Error('WhatsApp socket is not connected')

    const dbMsg = await prisma.message.findUnique({ where: { id: msgId } })
    if (!dbMsg || !dbMsg.content) throw new Error('Message not found')

    const rawMessage = JSON.parse(dbMsg.content)
    const unwrapped = messageService.unwrapMessage(rawMessage)
    
    let mediaType: 'image' | 'sticker' | 'video' | 'document' | null = null
    if (unwrapped.imageMessage) mediaType = 'image'
    else if (unwrapped.stickerMessage) mediaType = 'sticker'
    else if (unwrapped.videoMessage) mediaType = 'video'
    else if (unwrapped.documentMessage) mediaType = 'document'

    const mediaMsg = unwrapped.imageMessage || unwrapped.stickerMessage || unwrapped.videoMessage || unwrapped.documentMessage

    if (!mediaMsg || !mediaType) throw new Error('Not a media message')

    const mediaDir = join(app.getPath('userData'), 'media')
    if (!fs.existsSync(mediaDir)) fs.mkdirSync(mediaDir, { recursive: true })

    const fileName = messageService.getSafeMediaFileName(msgId, mediaType, mediaMsg)
    const filePath = join(mediaDir, fileName)

    if (!fs.existsSync(filePath)) {
        try {
            const stream = await downloadContentFromMessage(mediaMsg, mediaType as any)
            let buffer = Buffer.from([])
            for await (const chunk of stream) buffer = Buffer.concat([buffer, chunk])
            fs.writeFileSync(filePath, buffer)
        } catch (err: any) {
            // Re-fetch media if expired (410)
            if (err?.data === 410 || err?.output?.statusCode === 410) {
                const updatedMsg = await sock.updateMediaMessage({ key: { id: dbMsg.id, remoteJid: dbMsg.remoteJid, fromMe: dbMsg.fromMe, participant: dbMsg.participant }, message: rawMessage } as any)
                const updatedMedia = messageService.unwrapMessage(updatedMsg.message)
                const target = updatedMedia.imageMessage || updatedMedia.stickerMessage || updatedMedia.videoMessage
                if (target) {
                    const stream = await downloadContentFromMessage(target, mediaType as any)
                    let buffer = Buffer.from([])
                    for await (const chunk of stream) buffer = Buffer.concat([buffer, chunk])
                    fs.writeFileSync(filePath, buffer)
                    Object.assign(unwrapped, updatedMedia) // Update local object
                }
            } else throw err
        }
    }

    // Update local URI and save
    if (unwrapped.imageMessage) unwrapped.imageMessage.localURI = `app://media/${fileName}`
    if (unwrapped.stickerMessage) unwrapped.stickerMessage.localURI = `app://media/${fileName}`
    if (unwrapped.videoMessage) unwrapped.videoMessage.localURI = `app://media/${fileName}`
    if (unwrapped.documentMessage) unwrapped.documentMessage.localURI = `app://media/${fileName}`

    const updated = await prisma.message.update({
      where: { id: msgId },
      data: { content: JSON.stringify(rawMessage) }
    })

    const nameMap = await contactService.batchResolveNames([updated.participant || updated.remoteJid], sock)
    return messageService.enrichMessage(updated, sock, nameMap)
  })

  // ── Open File with System Default ──────────────────────────────────
  ipcMain.handle('open-file', async (_event, localURI: string) => {
    try {
        const fileName = decodeURIComponent(localURI.split('/').pop() || '')
        if (!fileName) return false
        
        const filePath = join(app.getPath('userData'), 'media', fileName)
        if (fs.existsSync(filePath)) {
            await shell.openPath(filePath)
            return true
        }
        return false
    } catch (err) {
        console.error('[IPC] Failed to open file:', err)
        return false
    }
  })

  // ── Logout ──────────────────────────────────────────────────────────
  ipcMain.handle('logout', async () => {
    const sock = getSock()
    if (sock) await sock.logout().catch(() => {})
    await prisma.message.deleteMany()
    await prisma.chat.deleteMany()
    await prisma.contact.deleteMany()
    await prisma.authState.deleteMany()
    return true
  })

  // ── Get Profile Picture ─────────────────────────────────────────────
  ipcMain.handle('get-profile-picture', async (_event, jid: string, type: 'preview' | 'image' = 'preview', forceRefresh: boolean = false) => {
    const sock = getSock()
    return contactService.getProfilePicture(jid, type, sock, forceRefresh)
  })

  // ── Get Group Metadata ────────────────────────────────────────────────
  ipcMain.handle('get-group-participants', async (_event, jid: string) => {
    const sock = getSock()
    if (!sock || !jid.endsWith('@g.us')) return []
    try {
      const metadata = await sock.groupMetadata(jid)
      const jids = metadata.participants.map(p => p.id)
      const nameMap = await contactService.batchResolveNames(jids, sock)
      return metadata.participants.map(p => ({
        jid: p.id,
        name: nameMap.get(p.id) || p.id.split('@')[0],
        isAdmin: !!p.admin,
        isMe: !!sock.user && p.id === sock.user.id
      }))
    } catch (err) {
      console.error('[IPC] get-group-participants failed:', err)
      return []
    }
  })

  // ── Global Search (chats, contacts, messages) ───────────────────────
  ipcMain.handle('search-all', async (_event, query: string, mode: 'normal' | 'deep' = 'normal', filters?: { jids?: string[], fromDate?: string, toDate?: string }) => {
    const sock = getSock()
    const parsedFilters = filters ? {
      jids: filters.jids,
      fromDate: filters.fromDate ? new Date(filters.fromDate) : undefined,
      toDate: filters.toDate ? new Date(filters.toDate) : undefined
    } : undefined
    return searchService.searchAll(query, mode, sock, parsedFilters)
  })

  // ── Index Embeddings (background, with progress events) ──────────────
  ipcMain.handle('index-embeddings', async (_event) => {
    const win = BrowserWindow.getAllWindows()[0]
    try {
      await embeddingService.indexAll((pct) => {
        win?.webContents.send('embedding-progress', pct)
      })
      win?.webContents.send('embedding-progress', 100)
    } catch (err) {
      console.error('[IPC] index-embeddings failed:', err)
    }
  })

  ipcMain.handle('clear-vectors', async (_event) => {
    try {
      await embeddingService.clearAllVectors()
    } catch (err) {
      console.error('[IPC] clear-vectors failed:', err)
    }
  })

  // ── AI Handlers ───────────────────────────────────────────────────────
  
  // Register AI Tools via dedicated initializer
  AIToolInitializer.initializeAll(getSock);

  ipcMain.handle('execute-tool', async (_event, toolName: string, args: any) => {
    const tool = toolRegistry.getTool(toolName);
    if (!tool) throw new Error(`Tool ${toolName} not found`);
    return await tool.execute(args);
  });

  ipcMain.handle('get-ai-tools', async () => {
    return toolRegistry.getAllTools().map(t => ({
      name: t.name,
      description: t.description,
      requiresPermission: t.requiresPermission
    }));
  });

  ipcMain.handle('ai-chat', async (_event, prompt: string, contextChats?: any[], history?: any[], mentions?: any[], options?: any) => {
    return await aiService.generateResponse(prompt, contextChats, history, mentions, options);
  })

  ipcMain.on('ai-chat-stream', async (event, args) => {
    const { channelId, prompt, contextChats, history, mentions, options } = args;
    try {
      await aiService.generateResponseStream(prompt, contextChats, history, mentions, options, (chunk) => {
        event.sender.send(`${channelId}-chunk`, chunk);
      });

      event.sender.send(`${channelId}-end`);
    } catch (err: any) {
      console.error('[IPC] ai-chat-stream error:', err);
      event.sender.send(`${channelId}-error`, err.message || String(err));
    }
  });

  ipcMain.handle('get-chat-context', async (_event, jid: string) => {
    // Get top 100 messages
    const messages = await prisma.message.findMany({
      where: { remoteJid: jid },
      orderBy: { timestamp: 'desc' },
      take: 100
    });
    
    const sock = getSock();
    const jids = new Set<string>();
    messages.forEach(m => {
      jids.add(m.remoteJid);
      if (m.participant) jids.add(m.participant);
    });

    const nameMap = await contactService.batchResolveNames(Array.from(jids), sock);
    
    const enriched = await Promise.all(
      messages.map(async (m) => await messageService.enrichMessage(m, sock, nameMap))
    );
    
    // Sort chronologically
    return enriched.reverse();
  })
}

// Exporting helpers for index.ts (legacy compatibility)
export const resolveContactName = (jid: string, chatName: string | null, sock: any) => 
    contactService.resolveName(jid, chatName, sock)
export const unwrapMessage = (msg: any) => messageService.unwrapMessage(msg)
