import { ipcMain } from 'electron'
import { PrismaClient } from '@prisma/client'
import fs from 'fs'
import { join } from 'path'
import { app } from 'electron'
import { downloadContentFromMessage, proto } from '@whiskeysockets/baileys'

function unwrapMessage(msg: any): any {
  if (!msg) return {}
  let unwrapped = msg
  if (unwrapped.ephemeralMessage) unwrapped = unwrapped.ephemeralMessage.message || unwrapped.ephemeralMessage
  if (unwrapped.viewOnceMessage) unwrapped = unwrapped.viewOnceMessage.message || unwrapped.viewOnceMessage
  if (unwrapped.viewOnceMessageV2) unwrapped = unwrapped.viewOnceMessageV2.message || unwrapped.viewOnceMessageV2
  if (unwrapped.viewOnceMessageV2Extension) unwrapped = unwrapped.viewOnceMessageV2Extension.message || unwrapped.viewOnceMessageV2Extension
  if (unwrapped.documentWithCaptionMessage) unwrapped = unwrapped.documentWithCaptionMessage.message || unwrapped.documentWithCaptionMessage
  return unwrapped
}

/**
 * Resolves a display name for a chat JID, using LID cross-resolution when needed.
 */
export async function resolveContactName(
  prisma: PrismaClient,
  jid: string,
  chatName: string | null
): Promise<string> {
  const contacts = await prisma.contact.findMany({
    where: {
      OR: [
        { id: jid },
        { lid: jid },
        { phoneNumber: jid }
      ]
    }
  })

  let phonebookName: string | null = null;
  let pushName: string | null = null;
  let verifiedName: string | null = null;
  let linkedPhone: string | null = null;

for (const c of contacts) {
    // 1. Undisputed Highest Priority: Standard rows (Phone Numbers, Groups @g.us, Channels)
    // If it has a name and IS NOT a LID row, it is the absolute source of truth.
    if (!c.id.includes('@lid') && c.name) {
      phonebookName = c.name;
    }

    // 2. Verified Business Names
    if (c.verifiedName) {
      verifiedName = c.verifiedName;
    }

    // 3. Fallbacks: PushName (notify) or a copied name on a LID row
    if (c.notify) {
      pushName = c.notify;
    } else if (c.id.includes('@lid') && c.name) {
      pushName = c.name; 
    }

    if (c.phoneNumber) linkedPhone = c.phoneNumber;
  }

  // Return strictly in hierarchy order
  if (phonebookName) return phonebookName;
  if (verifiedName) return verifiedName;
  if (pushName) return pushName;
  if (chatName) return chatName;

  // Fallback to Phone Number (if found via LID mapping)
  if (linkedPhone) return linkedPhone.replace(/@.*$/, '');

  // Absolute fallback: raw ID
  return jid.replace(/@.*$/, '');
}

/**
 * Registers all IPC handlers for chat data, messaging, and identity resolution.
 * Call this once at app startup.
 */
export function registerIpcHandlers(
  prisma: PrismaClient,
  getSock: () => ReturnType<typeof import('@whiskeysockets/baileys').default> | null
): void {
  // ── Get Chat List (paginated, sorted by latest timestamp) ────────────
  ipcMain.handle('get-chats', async (_event, page: number = 1, pageSize: number = 50) => {
    const chats = await prisma.chat.findMany()

    // Resolve display names from Contact table + fetch last message per chat
    const enriched = await Promise.all(
      chats.map(async (chat) => {
        // Resolve name with LID cross-resolution
        const name = await resolveContactName(prisma, chat.jid, chat.name)

        // Fetch the most recent message for preview
        const lastMsg = await prisma.message.findFirst({
          where: { remoteJid: chat.jid },
          orderBy: { timestamp: 'desc' },
          select: { textContent: true, messageType: true, timestamp: true }
        })

        // Use last message timestamp if chat timestamp is 0
        const effectiveTimestamp = lastMsg?.timestamp ?? chat.timestamp

        return {
          jid: chat.jid,
          name,
          unreadCount: chat.unreadCount,
          timestamp: effectiveTimestamp.toString(),
          lastMessage: lastMsg?.messageType === 'stickerMessage' ? 'Sticker' : (lastMsg?.textContent || (lastMsg?.messageType !== 'unknown' ? `[${lastMsg?.messageType}]` : '')),
          lastMessageTimestamp: (lastMsg?.timestamp ?? chat.timestamp).toString(),
          pinned: chat.pinned,
          muteExpiration: chat.muteExpiration.toString()
        }
      })
    )

    // Sort: pinned chats first (by pin timestamp desc), then by last message timestamp desc
    enriched.sort((a, b) => {
      // Pinned chats first
      if (a.pinned > 0 && b.pinned <= 0) return -1
      if (b.pinned > 0 && a.pinned <= 0) return 1
      // Within same pin group, sort by timestamp
      if (a.pinned > 0 && b.pinned > 0) {
        return b.pinned - a.pinned // Higher pin value = more recently pinned
      }
      const tsA = BigInt(a.lastMessageTimestamp)
      const tsB = BigInt(b.lastMessageTimestamp)
      if (tsB > tsA) return 1
      if (tsB < tsA) return -1
      return 0
    })

    const skip = (page - 1) * pageSize
    return enriched.slice(skip, skip + pageSize)
  })

  // ── Get Messages for a Chat (paginated) ──────────────────────────────
  ipcMain.handle(
    'get-messages',
    async (_event, jid: string, page: number = 1, pageSize: number = 50) => {
      const skip = (page - 1) * pageSize

      const messages = await prisma.message.findMany({
        where: { remoteJid: jid },
        orderBy: { timestamp: 'desc' },
        skip,
        take: pageSize,
        select: {
          id: true,
          remoteJid: true,
          fromMe: true,
          participant: true,
          timestamp: true,
          messageType: true,
          textContent: true,
          content: true
        }
      })

      // Return in chronological order (oldest first) for rendering
      const messageIds = messages.map((m) => m.id)
      const allReactions = await (prisma as any).reaction.findMany({
        where: { messageId: { in: messageIds } }
      })

      const senderIds = Array.from(new Set(allReactions.map((r: any) => r.senderId)))
      const nameMap = new Map<string, string>()
      await Promise.all(senderIds.map(async (id: any) => {
        const name = await resolveContactName(prisma, id, null)
        nameMap.set(id, name)
      }))

      const messagesWithNames = await Promise.all(
        messages.map(async (m) => {
          let contentStr = m.content
          const msgReactions = allReactions.filter((r) => r.messageId === m.id)
          if (contentStr) {
            try {
              const rawMsg = JSON.parse(contentStr)
              const ctx = rawMsg?.extendedTextMessage?.contextInfo || rawMsg?.imageMessage?.contextInfo || rawMsg?.contextInfo
              if (ctx?.participant) {
                const resolved = await resolveContactName(prisma, ctx.participant, null)
                ctx.participantName = resolved
                contentStr = (function safeStr(obj: any) {
                  try { return JSON.stringify(obj) } catch(e) {
                    return JSON.stringify(obj, (_k, v) => {
                      if (v && typeof v === 'object' && typeof v.toJSON === 'function') {
                        try { return v.toJSON() } catch(e) {
                          const copy: any = {}; for(const key in v) if(typeof v[key] !== 'function') copy[key] = v[key]; return copy;
                        }
                      } return v;
                    })
                  }
                })(rawMsg)
              }
            } catch (e) {}
          }

          return {
            ...m,
            content: contentStr,
            participantName: m.participant ? await resolveContactName(prisma, m.participant, null) : null,
            timestamp: m.timestamp.toString(),
            reactions: msgReactions.map((r: any) => ({ 
              ...r, 
              timestamp: r.timestamp.toString(),
              senderName: nameMap.get(r.senderId as string) || (r.senderId as string).replace(/@.*$/, '')
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
    if (!sock) {
      throw new Error('WhatsApp socket is not connected')
    }

    let quotedMessage: any = undefined
    let quotedFromMe = false
    if (quotedMsgId) {
      const qm = await prisma.message.findUnique({ where: { id: quotedMsgId } })
      if (qm && qm.content) {
        quotedFromMe = qm.fromMe
        try { 
          const plainQuoted = JSON.parse(qm.content) 
          quotedMessage = proto.Message.fromObject(plainQuoted)
        } catch (e) {
          console.error('[send-message] failed to hydrate quoted message', e)
        }
      }
    }

    // Send via Baileys and await server confirmation
    const options = quotedMessage ? { quoted: { key: { id: quotedMsgId, remoteJid: jid, fromMe: quotedFromMe }, message: quotedMessage } } : {}
    const sentMsg = await sock.sendMessage(jid, { text }, options as any)

    if (!sentMsg) {
      throw new Error('Failed to send message — no response from server')
    }

    // Extract fields for SQLite insertion
    const key = sentMsg.key
    const msgId = key?.id || `sent-${Date.now()}`
    const rawTs = sentMsg.messageTimestamp
    const timestamp = rawTs
      ? BigInt(
          typeof rawTs === 'object' && rawTs !== null && 'low' in (rawTs as unknown as Record<string, unknown>)
            ? ((rawTs as unknown as Record<string, unknown>).low as number)
            : (rawTs as number)
        )
      : BigInt(Math.floor(Date.now() / 1000))

    // Determine actual type for SQLite
    let messageType = 'conversation'
    if (sentMsg.message) {
      const typeKeys = ['conversation', 'extendedTextMessage', 'imageMessage', 'videoMessage', 'audioMessage', 'documentMessage']
      for (const k of typeKeys) {
        if ((sentMsg.message as any)[k]) { messageType = k; break; }
      }
    }

    // Persist to SQLite
    await prisma.message.upsert({
      where: { id: msgId },
      update: {},
      create: {
        id: msgId,
        remoteJid: jid,
        fromMe: true,
        participant: null,
        timestamp,
        messageType,
        content: (function safeStr(obj: any) {
          try { return JSON.stringify(obj) } catch(e) {
            return JSON.stringify(obj, (_k, v) => {
              if (v && typeof v === 'object' && typeof v.toJSON === 'function') {
                try { return v.toJSON() } catch(e) {
                  const copy: any = {}; for(const key in v) if(typeof v[key] !== 'function') copy[key] = v[key]; return copy;
                }
              } return v;
            })
          }
        })(sentMsg.message || {}),
        textContent: text
      }
    })

    // Update the chat timestamp
    await prisma.chat.upsert({
      where: { jid },
      update: { timestamp },
      create: { jid, timestamp, unreadCount: 0 }
    })

    // Return the message data for immediate UI rendering
    return {
      id: msgId,
      remoteJid: jid,
      fromMe: true,
      participant: null,
      timestamp: timestamp.toString(),
      messageType: 'conversation',
      textContent: text
    }
  })

  // ── Send Media Message ───────────────────────────────────────────────
  ipcMain.handle('send-media-message', async (_event, jid: string, filePath: string, caption?: string, quotedMsgId?: string) => {
    const sock = getSock()
    if (!sock) {
      throw new Error('WhatsApp socket is not connected')
    }

    let quotedMessage: any = undefined
    let quotedFromMe = false
    if (quotedMsgId) {
      const qm = await prisma.message.findUnique({ where: { id: quotedMsgId } })
      if (qm && qm.content) {
        quotedFromMe = qm.fromMe
        try { 
          const plainQuoted = JSON.parse(qm.content) 
          quotedMessage = proto.Message.fromObject(plainQuoted)
        } catch (e) {
          console.error('[send-media-message] failed to hydrate quoted message', e)
        }
      }
    }

    const buffer = fs.readFileSync(filePath)
    const options = quotedMessage ? { quoted: { key: { id: quotedMsgId, remoteJid: jid, fromMe: quotedFromMe }, message: quotedMessage } } : {}
    
    // Determine if it's a sticker (best guess: webp extension)
    const isSticker = filePath.toLowerCase().endsWith('.webp')
    const sendOptions: any = isSticker ? { sticker: buffer } : { image: buffer, caption }

    const sentMsg = await sock.sendMessage(jid, sendOptions, options as any)

    if (!sentMsg) {
      throw new Error('Failed to send media message — no response from server')
    }

    const key = sentMsg.key
    const msgId = key?.id || `sent-${Date.now()}`
    const rawTs = sentMsg.messageTimestamp
    const timestamp = rawTs
      ? BigInt(
          typeof rawTs === 'object' && rawTs !== null && 'low' in (rawTs as unknown as Record<string, unknown>)
            ? ((rawTs as unknown as Record<string, unknown>).low as number)
            : (rawTs as number)
        )
      : BigInt(Math.floor(Date.now() / 1000))

    // Determine actual type for SQLite
    let messageType = 'imageMessage'
    if (sentMsg.message) {
      const typeKeys = ['imageMessage', 'videoMessage', 'audioMessage', 'documentMessage', 'stickerMessage']
      for (const k of typeKeys) {
        if ((sentMsg.message as any)[k]) { messageType = k; break; }
      }
    }

    await prisma.message.upsert({
      where: { id: msgId },
      update: {},
      create: {
        id: msgId,
        remoteJid: jid,
        fromMe: true,
        participant: null,
        timestamp,
        messageType,
        content: (function safeStr(obj: any) {
          try { return JSON.stringify(obj) } catch(e) {
            return JSON.stringify(obj, (_k, v) => {
              if (v && typeof v === 'object' && typeof v.toJSON === 'function') {
                try { return v.toJSON() } catch(e) {
                  const copy: any = {}; for(const key in v) if(typeof v[key] !== 'function') copy[key] = v[key]; return copy;
                }
              } return v;
            })
          }
        })(sentMsg.message || {}),
        textContent: caption || null
      }
    })

    await prisma.chat.upsert({
      where: { jid },
      update: { timestamp },
      create: { jid, timestamp, unreadCount: 0 }
    })

    return {
      id: msgId,
      remoteJid: jid,
      fromMe: true,
      participant: null,
      timestamp: timestamp.toString(),
      messageType: 'imageMessage',
      textContent: caption || null
    }
  })

  // ── Mark Chat as Read (local only — no read receipts sent) ───────────
  ipcMain.handle('mark-read', async (_event, jid: string) => {
    await prisma.chat.update({
      where: { jid },
      data: { unreadCount: 0 }
    })
    console.log(`[mark-read] Cleared unread count for ${jid}`)
    return true
  })

  // ── Select File Dialog ───────────────────────────────────────────────
  ipcMain.handle('select-file', async () => {
    const { dialog, BrowserWindow } = require('electron')
    // Get focused window safely
    const win = BrowserWindow.getFocusedWindow()
    const { canceled, filePaths } = await dialog.showOpenDialog(win, {
      properties: ['openFile'],
      filters: [{ name: 'Media', extensions: ['jpg', 'png', 'jpeg', 'mp4', 'pdf', 'webp'] }]
    })
    if (canceled || filePaths.length === 0) return null
    return filePaths[0]
  })

  // ── Download Media ───────────────────────────────────────────────────
  ipcMain.handle('download-media', async (_event, msgId: string) => {
    const sock = getSock()
    if (!sock) throw new Error('WhatsApp socket is not connected')

    const dbMsg = await prisma.message.findUnique({ where: { id: msgId } })
    if (!dbMsg || !dbMsg.content) throw new Error('Message not found or no content')

    let rawMessage: any = {}
    try { rawMessage = JSON.parse(dbMsg.content) } catch (e) { throw new Error('Corrupted content') }

    const unwrapped = unwrapMessage(rawMessage)
    const mediaMsg = unwrapped.imageMessage || unwrapped.stickerMessage
    const mediaType = unwrapped.imageMessage ? 'image' : (unwrapped.stickerMessage ? 'sticker' : null)

    if (!mediaMsg || !mediaType) throw new Error('Not an image or sticker message')

    const mediaDir = join(app.getPath('userData'), 'media')
    if (!fs.existsSync(mediaDir)) {
        fs.mkdirSync(mediaDir, { recursive: true })
    }

    const ext = mediaType === 'sticker' ? 'webp' : 'jpg'
    const fileName = `${msgId}.${ext}`
    const filePath = join(mediaDir, fileName)

    if (!fs.existsSync(filePath)) {
        try {
            const stream = await downloadContentFromMessage(mediaMsg, mediaType as any)
            let buffer = Buffer.from([])
            for await (const chunk of stream) {
                buffer = Buffer.concat([buffer, chunk])
            }
            fs.writeFileSync(filePath, buffer)
        } catch (err: any) {
            console.error(`[Media] Error downloading media for ${msgId}:`, err)
            if (err?.data === 410 || err?.message?.includes('410') || err?.output?.statusCode === 410) {
                // To do late updateMediaMessage we need a full WAMessage object.
                // Reconstruct simple WAMessage wrapper:
                const msgWrapper = { key: { id: dbMsg.id, remoteJid: dbMsg.remoteJid, fromMe: dbMsg.fromMe, participant: dbMsg.participant }, message: rawMessage } as any
                const updatedMsg = await sock.updateMediaMessage(msgWrapper)
                const updatedMediaMsg = updatedMsg.message?.imageMessage || updatedMsg.message?.stickerMessage
                
                if (updatedMediaMsg) {
                    const stream = await downloadContentFromMessage(updatedMediaMsg, mediaType as any)
                    let buffer = Buffer.from([])
                    for await (const chunk of stream) { buffer = Buffer.concat([buffer, chunk]) }
                    fs.writeFileSync(filePath, buffer)
                    if (updatedMsg.message?.imageMessage) rawMessage.imageMessage = updatedMsg.message.imageMessage
                    if (updatedMsg.message?.stickerMessage) rawMessage.stickerMessage = updatedMsg.message.stickerMessage
                } else {
                    throw err
                }
            } else {
                throw err
            }
        }
    }

    if (unwrapped.imageMessage) unwrapped.imageMessage.localURI = `app://media/${fileName}`
    if (unwrapped.stickerMessage) unwrapped.stickerMessage.localURI = `app://media/${fileName}`
    const newContent = JSON.stringify(rawMessage)

    const updated = await prisma.message.update({
      where: { id: msgId },
      data: { content: newContent }
    })

    return {
      ...updated,
      content: newContent,
      participantName: updated.participant ? await resolveContactName(prisma, updated.participant, null) : null,
      timestamp: updated.timestamp.toString()
    }
  })

  // ── Logout & Wipe All Data ───────────────────────────────────────────
  ipcMain.handle('logout', async () => {
    console.log('[Logout] Wiping all data...')

    // Close the Baileys socket (non-blocking — wipe data even if this fails)
    const sock = getSock()
    if (sock) {
      try {
        await sock.logout('User requested logout')
      } catch (err) {
        console.warn('[Logout] Socket logout failed (will wipe data anyway):', err)
      }
    }

    // Wipe all tables
    await prisma.message.deleteMany()
    await prisma.chat.deleteMany()
    await prisma.contact.deleteMany()
    await prisma.authState.deleteMany()

    console.log('[Logout] All data wiped successfully')
    return true
  })
}

