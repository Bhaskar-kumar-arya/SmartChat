import { PrismaClient } from '@prisma/client'
import { contactService } from './services/contacts/ContactService'
import { mapBaileysStatus } from './services/whatsapp/ReceiptService'
import { cleanJid } from './utils'

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
  phoneNumberToLidMappings?: Array<{ lidJid: string; pnJid: string }>
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

  const { chats, contacts, messages, lidPnMappings, phoneNumberToLidMappings, progress, isLatest } = data

  let contactCount = 0
  let chatCount = 0
  let messageCount = 0

  // Clear in-memory JID lookup/link caches for a fresh sync chunk
  contactService.clearCaches()

  // Fetch all existing chat JIDs to avoid redundant DB queries during message upserts
  const existingChats = await prisma.chat.findMany({ select: { jid: true } })
  const processedChats = new Set<string>(existingChats.map(ch => ch.jid))

  // ── 1. Process LID <-> PN mappings FIRST ───────────────────────────
  if (lidPnMappings && lidPnMappings.length > 0) {
    let count = 0
    for (const mapping of lidPnMappings) {
      if (++count % 100 === 0) {
        await new Promise(r => setImmediate(r))
      }
      if (mapping.lid && mapping.pn) {
        await contactService.linkLidAndPn(mapping.lid, mapping.pn, 'history.sync').catch(() => {})
      }
    }
  }

  if (phoneNumberToLidMappings && phoneNumberToLidMappings.length > 0) {
    let count = 0
    for (const mapping of phoneNumberToLidMappings) {
      if (++count % 100 === 0) {
        await new Promise(r => setImmediate(r))
      }
      if (mapping.lidJid && mapping.pnJid) {
        await contactService.linkLidAndPn(mapping.lidJid, mapping.pnJid, 'history.sync.ph').catch(() => {})
      }
    }
  }

  // ── 2. Contacts ────────────────────────────────────────────────────────
  if (contacts && contacts.length > 0) {
    let count = 0
    for (const c of contacts) {
      if (!c.id) continue
      if (++count % 50 === 0) {
        await new Promise(r => setImmediate(r))
      }

      const cleanedId = cleanJid(c.id)
      // Skip bare LID contacts with no name data
      const isBareLid = cleanedId.endsWith('@lid')
        && !c.name && !c.notify && !c.pushName && !c.verifiedName
      if (isBareLid) continue

      const contactToUpsert = {
        ...c,
        id: cleanedId,
        lid: c.lid ? cleanJid(c.lid) : undefined,
        phoneNumber: c.phoneNumber ? cleanJid(c.phoneNumber) : undefined
      }

      await contactService.upsertContact(contactToUpsert).catch(() => {})

      // If the contact carries both a PN id and a separate lid, link them now
      if (!cleanedId.endsWith('@lid') && c.lid) {
        await contactService.linkLidAndPn(cleanJid(c.lid), cleanedId, 'history.sync.contact').catch(() => {})
      }
    }
    contactCount = contacts.length
  }

  // ── 3. Chats ─────────────────────────────────────────────────────────
  if (chats && chats.length > 0) {
    let count = 0
    for (const c of chats) {
      if (!c.id) continue
      if (++count % 50 === 0) {
        await new Promise(r => setImmediate(r))
      }
      const jid = cleanJid(String(c.id))
      const raw = c as any

      // If the chat object carries a linked accountLid, register the mapping immediately
      if (raw.accountLid && jid && !jid.endsWith('@lid') && jid.includes('@s.whatsapp.net')) {
        await contactService.linkLidAndPn(cleanJid(raw.accountLid), jid, 'history.sync.chat.accountLid').catch(() => {})
      }
      const hasCommunityData = raw.isCommunity !== undefined || 
                               raw.isParentGroup !== undefined || 
                               raw.isAnnounce !== undefined || 
                               raw.isCommunityAnnounce !== undefined || 
                               raw.isDefaultSubgroup !== undefined || 
                               raw.linkedParentJid !== undefined || 
                               raw.linkedParent !== undefined || 
                               raw.parentGroupId !== undefined;

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

      const updateData: any = {}
      if (timestamp !== BigInt(0)) updateData.timestamp = timestamp
      updateData.isArchived = isArchived
      if (raw.name !== undefined) updateData.name = raw.name

      let type = 'DM'
      let communityId: number | null = null

      if (hasCommunityData) {
        const isCommunity = raw.isCommunity === true || raw.isParentGroup === true
        const isAnnounce = raw.isCommunityAnnounce === true || raw.isDefaultSubgroup === true
        const linkedParentJid = raw.linkedParentJid || raw.linkedParent || raw.parentGroupId

        if (jid.endsWith('@g.us')) {
          if (isCommunity) type = 'COMMUNITY'
          else if (isAnnounce) type = 'ANNOUNCE'
          else if (linkedParentJid) type = 'SUBGROUP'
          else type = 'GROUP'
        }
        updateData.type = type

        const rootJid = isCommunity ? jid : (linkedParentJid ? cleanJid(linkedParentJid) : null)
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
        updateData.communityId = communityId
      }

      await prisma.chat.upsert({
        where: { jid },
        update: updateData,
        create: {
          jid,
          unreadCount: typeof c.unreadCount === 'number' ? c.unreadCount : 0,
          timestamp,
          isArchived,
          communityId: hasCommunityData ? communityId : null,
          type: hasCommunityData ? type : (jid.endsWith('@g.us') ? 'GROUP' : 'DM'),
          name: raw.name
        }
      })

      processedChats.add(jid)

      // Extract PN <-> LID mapping from participants in history sync
      if (raw.participant && Array.isArray(raw.participant)) {
        for (const p of raw.participant) {
          const lid = p.userJid || p.id || p.lid
          const pn = p.phoneNumberJid || p.phoneNumber
          if (lid && pn) {
            const cleanLid = cleanJid(String(lid))
            const cleanPn = cleanJid(String(pn))
            if (cleanLid.includes('@lid') && cleanPn.includes('@s.whatsapp.net')) {
              await contactService.linkLidAndPn(cleanLid, cleanPn, 'history.sync.participant').catch(() => {})
            }
          }
        }
      }
    }
    chatCount = chats.length
  }

  // ── 4. Messages ──────────────────────────────────────────────────────
  if (messages && messages.length > 0) {
    // Build an in-memory cache of JID -> identityId to avoid millions of awaits
    const aliasRows = await prisma.identityAlias.findMany()
    const identityCache = new Map<string, number>()
    for (const row of aliasRows) {
      identityCache.set(row.jid, row.identityId)
    }

    const BATCH_SIZE = 200

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

        const remoteJid = cleanJid(String(key.remoteJid ?? ''))
        const participantRaw = key.participant ? String(key.participant) : (remoteJid.endsWith('@g.us') ? null : remoteJid)
        const participantString = participantRaw ? cleanJid(participantRaw) : null
        
        let senderId: number | null = null
        if (!key.fromMe && participantString) {
          if (identityCache.has(participantString)) {
            senderId = identityCache.get(participantString)!
          } else {
            await contactService.upsertContact({ id: participantString }).catch(() => {})
            const newId = await contactService.getIdentityIdByJid(participantString)
            if (newId) {
              senderId = newId
              identityCache.set(participantString, newId)
            }
          }
        }

        // Ensure Chat exists (skip if already seen in processedChats cache)
        if (!processedChats.has(remoteJid)) {
          const chatType = remoteJid.endsWith('@g.us') ? 'GROUP' : 'DM'
          await prisma.chat.upsert({
            where: { jid: remoteJid },
            update: {},
            create: { jid: remoteJid, type: chatType }
          }).catch(() => {})
          processedChats.add(remoteJid)
        }

        messageData.push({
          id: String(key.id),
          chatJid: remoteJid,
          fromMe: key.fromMe === true,
          senderId,
          participant: participantString,
          timestamp,
          messageType: getMessageType(message),
          content: JSON.stringify(message ?? {}),
          textContent: extractTextContent(message),
          status: mapBaileysStatus(m.status as number | null | undefined)
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

        const standardMessages = messageData.filter(m => m.messageType !== 'reactionMessage')
        if (standardMessages.length > 0) {
          // Pre-check existences in database to prevent transaction locking issues
          const batchIds = standardMessages.map(m => m.id)
          const existingMsgs = await prisma.message.findMany({
            where: { id: { in: batchIds } },
            select: { id: true }
          })
          const existingIds = new Set(existingMsgs.map(m => m.id))

          const newMessages = standardMessages.filter(m => !existingIds.has(m.id))
          const existingMessages = standardMessages.filter(m => existingIds.has(m.id))

          if (newMessages.length > 0) {
            await (prisma.message as any).createMany({
              data: newMessages
            }).catch(async () => {
              // fallback to single upserts in a transaction if createMany fails
              const fallbackOps = newMessages.map(m => prisma.message.upsert({
                where: { id: m.id },
                update: m,
                create: m
              }))
              await prisma.$transaction(fallbackOps).catch(err => console.error('[HistorySync] createMany fallback failed:', err))
            })
          }

          if (existingMessages.length > 0) {
            const updateOps = existingMessages.map(msg => {
              const update: Record<string, unknown> = {}
              if (msg.chatJid) update.chatJid = msg.chatJid
              if (msg.senderId !== undefined) update.senderId = msg.senderId
              if (msg.participant !== undefined) update.participant = msg.participant
              if (msg.timestamp) update.timestamp = msg.timestamp
              if (msg.messageType !== 'unknown') update.messageType = msg.messageType
              if (msg.content !== '{}') update.content = msg.content
              if (msg.textContent !== null) update.textContent = msg.textContent
              update.fromMe = msg.fromMe
              return prisma.message.update({
                where: { id: msg.id },
                data: update
              })
            })
            await prisma.$transaction(updateOps).catch(err => console.error('[HistorySync] Update existing messages failed:', err))
          }
        }
        
        if (reactionOps.length > 0) {
          await prisma.$transaction(reactionOps).catch(err => console.error('[HistorySync] Reaction transaction failed:', err))
        }

        messageCount += messageData.length
        await new Promise(resolve => setImmediate(resolve))
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