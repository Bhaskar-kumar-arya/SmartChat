import { PrismaClient } from '@prisma/client'
import { communityLogger } from './services/CommunityLogger'

/**
 * Determines the high-level message type from a Baileys proto.IMessage object.
 */
function getMessageType(message: Record<string, unknown> | null | undefined): string {
  if (!message) return 'unknown'

  const typeKeys = [
    'conversation',
    'extendedTextMessage',
    'imageMessage',
    'videoMessage',
    'audioMessage',
    'documentMessage',
    'stickerMessage',
    'contactMessage',
    'locationMessage',
    'liveLocationMessage',
    'reactionMessage',
    'pollCreationMessage',
    'pollUpdateMessage',
    'protocolMessage',
    'senderKeyDistributionMessage'
  ]

  for (const key of typeKeys) {
    if (message[key] !== undefined && message[key] !== null) {
      return key
    }
  }

  for (const key of Object.keys(message)) {
    if (message[key] !== undefined && message[key] !== null) {
      return key
    }
  }

  return 'unknown'
}

/**
 * Extracts plain text content from a Baileys message for fast SQL searching.
 */
function extractTextContent(message: Record<string, unknown> | null | undefined): string | null {
  if (!message) return null

  if (typeof message.conversation === 'string') {
    return message.conversation
  }

  const extText = message.extendedTextMessage as Record<string, unknown> | undefined
  if (extText && typeof extText.text === 'string') {
    return extText.text
  }

  for (const key of ['imageMessage', 'videoMessage', 'documentMessage']) {
    const media = message[key] as Record<string, unknown> | undefined
    if (media && typeof media.caption === 'string') {
      return media.caption
    }
  }

  return null
}

export interface HistorySyncData {
  chats: Array<Record<string, unknown>>
  contacts: Array<Record<string, unknown>>
  messages: Array<Record<string, unknown>>
  lidPnMappings?: Array<{ lid: string; pn: string }>
  syncType: unknown
  isLatest: boolean
  progress: number
}

export interface HistorySyncResult {
  progress: number
  isLatest: boolean
  contactCount: number
  chatCount: number
  messageCount: number
}

export async function handleHistorySync(
  data: HistorySyncData,
  prisma: PrismaClient
): Promise<HistorySyncResult> {

  const { chats, contacts, messages, lidPnMappings, progress, isLatest } = data

  let contactCount = 0
  let chatCount = 0
  let messageCount = 0

  // ── 1. Process LID <-> PN mappings FIRST ───────────────────────────

  const mappingDict = new Map<string, string>() // LID -> PN


  if (lidPnMappings && lidPnMappings.length > 0) {
    for (const mapping of lidPnMappings) {
      if (mapping.lid && mapping.pn) {
        mappingDict.set(mapping.lid, mapping.pn)
      }
    }
  }

  // ── 2. Contacts ────────────────────────────────────────────────────

  // ── 2. Contacts ────────────────────────────────────────────────────────
  if (contacts && contacts.length > 0) {
    const jidToData = new Map<string, { name?: string, notify?: string, verifiedName?: string, lid?: string }>()

    // Initial collection
    for (const c of contacts) {
      if (!c.id) continue
      const id = String(c.id)
      const existing = jidToData.get(id) || {}

      jidToData.set(id, {
        name: (c.name as string) || existing.name,
        notify: (c.notify as string) || (c.pushName as string) || existing.notify,
        verifiedName: (c.verifiedName as string) || existing.verifiedName,
        lid: (c.lid as string) || existing.lid // Grab LID directly from contact if it exists
      })
    }

    const contactOps: any[] = [];
    const claimedLids = new Set<string>(); // Tracks LIDs in this specific batch
    const lidsToClear = new Set<string>();

    for (const [id, data] of jidToData.entries()) {
      const isLid = id.endsWith('@lid');
      const isPn = id.endsWith('@s.whatsapp.net');

      let mappedLid: string | null = null;
      let mappedPn: string | null = null;

      if (isLid) {
        // RULE 1: If the ID is a LID, the 'lid' column MUST be null to prevent P2002.
        if (mappingDict.has(id)) {
          mappedPn = mappingDict.get(id)!;
        }
      } else if (isPn) {
        // RULE 2: If the ID is a PN, we can safely set the 'lid' column.
        for (const [keyLid, valPn] of mappingDict.entries()) {
          if (valPn === id) {
            mappedLid = keyLid;
            break;
          }
        }
        // Fallback: use the LID provided in the contact payload
        if (!mappedLid && data.lid) {
          mappedLid = data.lid;
        }
      }

      // RULE 3: Prevent duplicate LIDs within the same transaction batch
      if (mappedLid) {
        if (claimedLids.has(mappedLid)) {
          mappedLid = null; // Strip it if another record in this chunk already claimed it
        } else {
          claimedLids.add(mappedLid);
          lidsToClear.add(mappedLid);
        }
      }

      const bestName = data.name || data.notify || data.verifiedName;

      // Build the update payload dynamically so we don't squash 'name' with 'notify'
      const updatePayload: any = {};
      if (data.name) updatePayload.name = data.name;
      if (data.notify !== undefined) updatePayload.notify = data.notify;
      if (data.verifiedName !== undefined) updatePayload.verifiedName = data.verifiedName;
      if (mappedLid !== null) updatePayload.lid = mappedLid;
      if (mappedPn !== null) updatePayload.phoneNumber = mappedPn;

      contactOps.push(
        prisma.contact.upsert({
          where: { id },
          update: updatePayload,
          create: {
            id,
            name: bestName || null,
            notify: data.notify || null,
            verifiedName: data.verifiedName || null,
            lid: mappedLid || null,
            phoneNumber: mappedPn || null
          }
        })
      );
    }

    if (contactOps.length > 0) {
      // Yield to event loop to keep UI responsive
      await new Promise(resolve => setTimeout(resolve, 0))

      // ── Clear LIDs in chunks to avoid SQLite limit ──
      const lidArray = Array.from(lidsToClear);
      const CLEAR_BATCH_SIZE = 500;
      for (let i = 0; i < lidArray.length; i += CLEAR_BATCH_SIZE) {
        const chunk = lidArray.slice(i, i + CLEAR_BATCH_SIZE);
        await prisma.contact.updateMany({
          where: { lid: { in: chunk } },
          data: { lid: null }
        });
      }

      // ── Process upserts in batches ──
      const BATCH_SIZE = 500;
      for (let i = 0; i < contactOps.length; i += BATCH_SIZE) {
        await prisma.$transaction(contactOps.slice(i, i + BATCH_SIZE));
      }
    }
    contactCount = jidToData.size
  }

  // ── Chats ─────────────────────────────────────────────────────────

  if (chats && chats.length > 0) {

    const chatOps = chats
      .filter((c) => c.id)
      .map((c) => {

        const jid = String(c.id)
        
        // Community Metadata Detection & Logging (REFINED based on log analysis)
        // History Sync objects use 'isParentGroup' and 'parentGroupId'
        const raw = c as any
        const isCommunity = raw.isCommunity === true || raw.isParentGroup === true
        const isAnnounce = raw.isCommunityAnnounce === true || raw.isDefaultSubgroup === true
        const linkedParent = raw.linkedParentJid || raw.linkedParent || raw.parentGroupId

        if (isCommunity || isAnnounce || linkedParent) {
          communityLogger.log(`Found community-related chat: ${jid}`, {
            isCommunity,
            isAnnounce,
            linkedParent,
            name: raw.name
          })
        }

        const unreadCount =
          typeof c.unreadCount === 'number'
            ? c.unreadCount
            : undefined

        const isArchived =
          ('archived' in c || 'isArchived' in c)
            ? (c.archived === true || c.isArchived === true)
            : undefined

        let timestamp: bigint | undefined = undefined

        const ts =
          c.conversationTimestamp ??
          c.timestamp

        if (ts !== undefined && ts !== null) {

          timestamp = BigInt(
            typeof ts === 'object' && 'low' in (ts as Record<string, unknown>)
              ? (ts as Record<string, unknown>).low as number
              : (ts as number)
          )

        }

        return prisma.chat.upsert({
          where: { jid },
          update: {
            unreadCount,
            timestamp,
            isArchived
          },
          create: {
            jid,
            unreadCount: unreadCount ?? 0,
            timestamp: timestamp ?? BigInt(0),
            isArchived: isArchived ?? false
          }
        })

      })

    if (chatOps.length > 0) {
      await prisma.$transaction(chatOps)
      chatCount = chatOps.length
    }

  }

  // ── Messages ──────────────────────────────────────────────────────

  if (messages && messages.length > 0) {

    const BATCH_SIZE = 500

    for (let i = 0; i < messages.length; i += BATCH_SIZE) {

      const batch = messages.slice(i, i + BATCH_SIZE)

      const messageData = batch
        .filter((m) => {
          const key = m.key as Record<string, unknown> | undefined
          return key && key.id
        })
        .map((m) => {

          const key = m.key as Record<string, unknown>
          const message = m.message as Record<string, unknown> | null | undefined

          const ts = m.messageTimestamp ?? 0

          const timestamp = BigInt(
            typeof ts === 'object' &&
              ts !== null &&
              'low' in (ts as Record<string, unknown>)
              ? (ts as Record<string, unknown>).low as number
              : (ts as number)
          )

          return {
            id: String(key.id),
            remoteJid: String(key.remoteJid ?? ''),
            fromMe: key.fromMe === true,
            participant: key.participant ? String(key.participant) : null,
            timestamp,
            messageType: getMessageType(message),
            content: JSON.stringify(message ?? {}),
            textContent: extractTextContent(message)
          }

        })

      if (messageData.length > 0) {

        const msgOps: any[] = []
        const reactionOps: any[] = []

        for (const msg of messageData) {
          if (msg.messageType === 'reactionMessage') {
            try {
              const rawMsg = JSON.parse(msg.content)
              const reaction = rawMsg.reactionMessage
              if (reaction && reaction.key && reaction.key.id) {
                const targetId = reaction.key.id
                const emoji = reaction.text
                const senderId = msg.participant || msg.remoteJid
                
                if (emoji) {
                  reactionOps.push(
                    (prisma as any).reaction.upsert({
                      where: { messageId_senderId: { messageId: targetId, senderId } },
                      update: { text: emoji, timestamp: msg.timestamp },
                      create: {
                        messageId: targetId,
                        remoteJid: msg.remoteJid,
                        senderId,
                        text: emoji,
                        timestamp: msg.timestamp
                      }
                    })
                  )
                }
              }
            } catch (e) {}
          } else {
            const update: Record<string, unknown> = {}
            if (msg.remoteJid) update.remoteJid = msg.remoteJid
            if (msg.participant !== null) update.participant = msg.participant
            if (msg.timestamp) update.timestamp = msg.timestamp
            if (msg.messageType !== 'unknown') update.messageType = msg.messageType
            if (msg.content !== '{}') update.content = msg.content
            if (msg.textContent !== null) update.textContent = msg.textContent
            update.fromMe = msg.fromMe

            msgOps.push(
              prisma.message.upsert({
                where: { id: msg.id },
                update,
                create: msg
              })
            )
          }
        }

        if (msgOps.length > 0) {
          // Use createMany with skipDuplicates for much faster bulk insertion in SQLite
          // This avoids the SELECT -> INSERT/UPDATE overhead of individual upserts
          try {
            await (prisma.message as any).createMany({
              data: messageData.filter(m => m.messageType !== 'reactionMessage'),
              skipDuplicates: true
            })
          } catch (e) {
            // Fallback to individual upserts if createMany fails (unlikely in modern Prisma)
            await prisma.$transaction(msgOps)
          }
        }
        
        if (reactionOps.length > 0) await prisma.$transaction(reactionOps)

        messageCount += messageData.length
        
        // Yield to event loop between chunks
        await new Promise(resolve => setTimeout(resolve, 0))
      }

    }

  }

  console.log(
    `[HistorySync] progress=${progress}% | contacts=${contactCount} chats=${chatCount} messages=${messageCount} | isLatest=${isLatest} | LID PN Mappings: ${mappingDict.size}`
  )

  return {
    progress,
    isLatest,
    contactCount,
    chatCount,
    messageCount
  }

}