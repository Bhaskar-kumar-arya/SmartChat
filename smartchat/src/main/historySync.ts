import { PrismaClient } from '@prisma/client'
import { contactService } from './services/ContactService'

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
  if (lidPnMappings && lidPnMappings.length > 0) {
    for (const mapping of lidPnMappings) {
      if (mapping.lid && mapping.pn) {
        await contactService.linkLidAndPn(mapping.lid, mapping.pn).catch(() => {})
      }
    }
  }

  // ── 2. Contacts ────────────────────────────────────────────────────────
  if (contacts && contacts.length > 0) {
    for (const c of contacts) {
      if (!c.id) continue
      await contactService.upsertContact(c).catch(() => {})
    }
    contactCount = contacts.length
  }

  // ── Chats ─────────────────────────────────────────────────────────

  if (chats && chats.length > 0) {
    for (const c of chats) {
      if (!c.id) continue
      const jid = String(c.id)
      const raw = c as any
      const isCommunity = raw.isCommunity === true || raw.isParentGroup === true
      const isAnnounce = raw.isCommunityAnnounce === true || raw.isDefaultSubgroup === true
      const linkedParentJid = raw.linkedParentJid || raw.linkedParent || raw.parentGroupId

      let type = 'DM'
      if (jid.endsWith('@g.us')) {
        if (isCommunity) type = 'COMMUNITY'
        else if (isAnnounce) type = 'ANNOUNCE'
        else if (linkedParentJid) type = 'SUBGROUP'
        else type = 'GROUP'
      }

      const rootJid = isCommunity ? jid : (linkedParentJid || null)
      let communityId: number | null = null

      if (rootJid) {
        const comm = await prisma.community.upsert({
          where: { jid: rootJid },
          update: {},
          create: { jid: rootJid, name: isCommunity ? raw.name : null }
        })
        communityId = comm.id
        
        if (isAnnounce && rootJid) {
          await prisma.community.update({
            where: { id: communityId },
            data: { announceJid: jid }
          }).catch(() => {})
        }
      }

      const ts = c.conversationTimestamp ?? c.timestamp
      let timestamp = BigInt(0)
      if (ts !== undefined && ts !== null) {
        timestamp = BigInt(
          typeof ts === 'object' && 'low' in (ts as Record<string, unknown>)
            ? (ts as Record<string, unknown>).low as number
            : (ts as number)
        )
      }

      const isArchived = ('archived' in c || 'isArchived' in c) ? (c.archived === true || c.isArchived === true) : false

      await prisma.chat.upsert({
        where: { jid },
        update: {
          timestamp,
          isArchived,
          communityId,
          type,
          name: raw.name
        },
        create: {
          jid,
          unreadCount: typeof c.unreadCount === 'number' ? c.unreadCount : 0,
          timestamp,
          isArchived,
          communityId,
          type,
          name: raw.name
        }
      })
    }
    chatCount = chats.length
  }

  // ── Messages ──────────────────────────────────────────────────────

  if (messages && messages.length > 0) {
    // 1. Build an in-memory cache of JID -> identityId to avoid millions of awaits
    const aliasRows = await prisma.identityAlias.findMany()
    const identityCache = new Map<string, number>()
    for (const row of aliasRows) identityCache.set(row.jid, row.identityId)

    const BATCH_SIZE = 500

    for (let i = 0; i < messages.length; i += BATCH_SIZE) {
      const batch = messages.slice(i, i + BATCH_SIZE)
      const messageData: any[] = []

      for (const m of batch) {
        const key = m.key as Record<string, unknown> | undefined
        if (!key || !key.id) continue

        const message = m.message as Record<string, unknown> | null | undefined
        const ts = m.messageTimestamp ?? 0
        const timestamp = BigInt(
          typeof ts === 'object' && ts !== null && 'low' in (ts as Record<string, unknown>)
            ? (ts as Record<string, unknown>).low as number
            : (ts as number)
        )

        const remoteJid = String(key.remoteJid ?? '')
        const participantString = key.participant ? String(key.participant) : (remoteJid.endsWith('@g.us') ? null : remoteJid)
        
        let senderId: number | null = null
        if (!key.fromMe && participantString) {
          if (identityCache.has(participantString)) {
            senderId = identityCache.get(participantString)!
          } else {
            // Need to create it
            await contactService.upsertContact({ id: participantString }).catch(() => {})
            const newId = await contactService.getIdentityIdByJid(participantString)
            if (newId) {
              senderId = newId
              identityCache.set(participantString, newId)
            }
          }
        }

        // Ensure Chat exists
        const chatType = remoteJid.endsWith('@g.us') ? 'GROUP' : 'DM'
        await prisma.chat.upsert({
          where: { jid: remoteJid },
          update: {},
          create: { jid: remoteJid, type: chatType }
        }).catch(() => {})

        messageData.push({
          id: String(key.id),
          chatJid: remoteJid,
          fromMe: key.fromMe === true,
          senderId,
          participant: participantString,
          timestamp,
          messageType: getMessageType(message),
          content: JSON.stringify(message ?? {}),
          textContent: extractTextContent(message)
        })
      }

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
                
                let reactorId = msg.senderId
                if (msg.fromMe) {
                  const meIdent = await prisma.identity.findFirst({ where: { isMe: true } })
                  if (meIdent) reactorId = meIdent.id
                }

                if (emoji && reactorId) {
                  reactionOps.push(
                    (prisma as any).reaction.upsert({
                      where: { messageId_senderId: { messageId: targetId, senderId: reactorId } },
                      update: { text: emoji, timestamp: msg.timestamp },
                      create: {
                        messageId: targetId,
                        senderId: reactorId,
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
            if (msg.chatJid) update.chatJid = msg.chatJid
            if (msg.senderId !== undefined) update.senderId = msg.senderId
            if (msg.participant !== undefined) update.participant = msg.participant
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
          try {
            await (prisma.message as any).createMany({
              data: messageData.filter(m => m.messageType !== 'reactionMessage'),
              skipDuplicates: true
            })
          } catch (e) {
            await prisma.$transaction(msgOps)
          }
        }
        
        if (reactionOps.length > 0) await prisma.$transaction(reactionOps)

        messageCount += messageData.length
        await new Promise(resolve => setTimeout(resolve, 0))
      }
    }
  }

  console.log(
    `[HistorySync] progress=${progress}% | contacts=${contactCount} chats=${chatCount} messages=${messageCount} | isLatest=${isLatest}`
  )

  return {
    progress,
    isLatest,
    contactCount,
    chatCount,
    messageCount
  }
}