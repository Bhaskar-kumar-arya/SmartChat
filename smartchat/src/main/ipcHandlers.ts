import { ipcMain } from 'electron'
import { PrismaClient } from '@prisma/client'

/**
 * Resolves a display name for a chat JID, using LID cross-resolution when needed.
 */
async function resolveContactName(
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
          lastMessage: lastMsg?.textContent || (lastMsg?.messageType !== 'unknown' ? `[${lastMsg?.messageType}]` : ''),
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
          textContent: true
        }
      })

      // Return in chronological order (oldest first) for rendering
      return messages
        .map((m) => ({
          ...m,
          timestamp: m.timestamp.toString()
        }))
        .reverse()
    }
  )

  // ── Send Message ─────────────────────────────────────────────────────
  ipcMain.handle('send-message', async (_event, jid: string, text: string) => {
    const sock = getSock()
    if (!sock) {
      throw new Error('WhatsApp socket is not connected')
    }

    // Send via Baileys and await server confirmation
    const sentMsg = await sock.sendMessage(jid, { text })

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
        messageType: 'conversation',
        content: JSON.stringify(sentMsg.message || {}),
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

  // ── Mark Chat as Read (local only — no read receipts sent) ───────────
  ipcMain.handle('mark-read', async (_event, jid: string) => {
    await prisma.chat.update({
      where: { jid },
      data: { unreadCount: 0 }
    })
    console.log(`[mark-read] Cleared unread count for ${jid}`)
    return true
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

