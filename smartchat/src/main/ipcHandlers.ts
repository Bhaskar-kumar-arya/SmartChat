import { ipcMain, app, dialog, BrowserWindow, shell } from 'electron'
import { PrismaClient } from '@prisma/client'
import fs from 'fs'
import { join } from 'path'
import { downloadContentFromMessage, proto } from '@whiskeysockets/baileys'
import { contactService } from './services/ContactService'
import { messageService } from './services/MessageService'
import { chatService } from './services/ChatService'

/**
 * Registers all IPC handlers for chat data, messaging, and identity resolution.
 */
export function registerIpcHandlers(
  prisma: PrismaClient,
  getSock: () => ReturnType<typeof import('@whiskeysockets/baileys').default> | null
): void {
  // ── Get Chat List (paginated, sorted by latest timestamp) ────────────
  ipcMain.handle('get-chats', async (_event, page: number = 1, pageSize: number = 50) => {
    const chats = await prisma.chat.findMany()
    const sock = getSock()

    // 1. Collect all JIDs for name resolution
    const jids = chats.map(c => c.jid)
    
    // 2. Fetch last messages in bulk (optional optimization, current implementation is one by one)
    // For now, we'll keep the lastMsg fetch one-by-one but batch the names.
    
    // 3. Resolve all names in one DB query (Fixes N+1)
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
          muteExpiration: chat.muteExpiration.toString()
        }
      })
    )

    // Sort: pinned chats first, then by last message timestamp desc
    enriched.sort((a, b) => {
      if (a.pinned > 0 && b.pinned <= 0) return -1
      if (b.pinned > 0 && a.pinned <= 0) return 1
      if (a.pinned > 0 && b.pinned > 0) return b.pinned - a.pinned
      const tsA = BigInt(a.lastMessageTimestamp)
      const tsB = BigInt(b.lastMessageTimestamp)
      return tsB > tsA ? 1 : (tsB < tsA ? -1 : 0)
    })

    const skip = (page - 1) * pageSize
    return enriched.slice(skip, skip + pageSize)
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
  ipcMain.handle('send-message', async (_event, jid: string, text: string, quotedMsgId?: string) => {
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

    const sentMsg = await sock.sendMessage(jid, { text }, { quoted } as any)
    if (!sentMsg) throw new Error('Failed to send message')

    // Persist via Service
    const processed = await messageService.processMessage(sentMsg, sock)
    await chatService.updateTimestamp(jid, processed.timestamp)

    // Enrich for UI
    const nameMap = await contactService.batchResolveNames([processed.participant || jid], sock)
    return messageService.enrichMessage(processed, sock, nameMap)
  })

  // ── Send Media Message ───────────────────────────────────────────────
  ipcMain.handle('send-media-message', async (_event, jid: string, filePath: string, caption?: string, quotedMsgId?: string) => {
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

    const sentMsg = await sock.sendMessage(jid, sendOptions, { quoted } as any)
    if (!sentMsg) throw new Error('Failed to send media message')

    // Persist and enrich
    const processed = await messageService.processMessage(sentMsg, sock)
    await chatService.updateTimestamp(jid, processed.timestamp)
    
    const nameMap = await contactService.batchResolveNames([processed.participant || jid], sock)
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
}

// Exporting helpers for index.ts (legacy compatibility)
export const resolveContactName = (prisma: any, jid: string, chatName: string | null, sock: any) => 
    contactService.resolveName(jid, chatName, sock)
export const unwrapMessage = (msg: any) => messageService.unwrapMessage(msg)
