import { BrowserWindow } from 'electron'
import { PrismaClient } from '@prisma/client'
import { WASocket } from '../../types'
import { cleanJid } from '../../utils'
import {
  PROTOCOL_TYPE_REVOKE,
  PROTOCOL_TYPE_EDIT
} from '../../constants'
import type { ServiceContainer } from '../../ServiceContainer'

export class WAEventHandler {
  constructor(
    private services: ServiceContainer,
    private getMainWindow: () => BrowserWindow | null,
    private prisma: PrismaClient
  ) {}

  async handleMessagesUpsert(data: { messages: any[]; type: string }, sock: WASocket): Promise<void> {
    const { messages, type } = data
    const mainWindow = this.getMainWindow()

    // 'append' = backlog catch-up after reconnect. Fast bulk path.
    if (type === 'append') {
      try {
        await this.services.messageService.bulkPersistMessages(messages)
      } catch (err) {
        console.error('[messages.upsert:append] Bulk persist error:', err)
      }
    } else {
      // 'notify' = real-time new message. Full enrichment pipeline.
      for (const msg of messages) {
        try {
          const processed = await this.services.messageService.processMessage(msg, sock)
          if (!processed) continue

          if ('type' in processed) {
            if (processed.subType === 'revoke') {
              if (mainWindow && !mainWindow.isDestroyed()) {
                mainWindow.webContents.send('message-deleted', {
                  id: processed.targetId,
                  chatJid: cleanJid(processed.key.remoteJid),
                  fromMe: processed.key.fromMe
                })
              }
            } else if (processed.subType === 'edit') {
              if (mainWindow && !mainWindow.isDestroyed()) {
                const dbMsg = await this.prisma.message.findUnique({ where: { id: processed.targetId } })
                if (dbMsg) {
                  const nameMap = await this.services.contactService.batchResolveNames([cleanJid(dbMsg.participant || dbMsg.chatJid)], sock)
                  const enriched = await this.services.messageService.enrichMessage(dbMsg, sock, nameMap)
                  mainWindow.webContents.send('message-edited', enriched)
                }
              }
            }
            continue
          }

          const { chatJid, timestamp, messageType, participant } = processed

          if (!processed.fromMe) {
            if (messageType !== 'reactionMessage') {
              await this.services.chatService.incrementUnread(chatJid, timestamp)
            }
          } else if (messageType !== 'reactionMessage') {
            await this.services.chatService.updateTimestamp(chatJid, timestamp)
          }

          if (mainWindow && !mainWindow.isDestroyed()) {
            const jids = new Set<string>([cleanJid(participant || chatJid)])
            const nameMap = await this.services.contactService.batchResolveNames(Array.from(jids), sock)
            const enriched = await this.services.messageService.enrichMessage(processed, sock, nameMap)
            mainWindow.webContents.send('new-message', enriched)
          }
        } catch (err) {
          console.error('[messages.upsert:notify] Error processing message:', err)
        }
      }
    }
  }

  async handleMessagesUpdate(updates: any[], sock: WASocket): Promise<void> {
    const mainWindow = this.getMainWindow()
    for (const update of updates) {
      try {
        // Process status updates (e.g. server ack)
        if (update.update?.status !== undefined && update.key?.id) {
          await this.services.receiptService.processMessageStatusUpdate(
            update.key,
            update.update.status,
            mainWindow
          ).catch(() => {})
        }

        const protocol = update.update?.protocolMessage
        if (!protocol) continue
        const key = protocol.key
        if (!key?.id) continue

        switch (protocol.type) {
          case PROTOCOL_TYPE_REVOKE: // REVOKE
            console.log('[messages.update] Message revoked:', key.id)
            await this.prisma.message.update({
              where: { id: key.id },
              data: { isDeleted: true }
            }).catch(() => { })
            if (mainWindow && !mainWindow.isDestroyed()) {
              mainWindow.webContents.send('message-deleted', {
                id: key.id,
                chatJid: cleanJid(key.remoteJid),
                fromMe: key.fromMe
              })
            }
            break

          case PROTOCOL_TYPE_EDIT: { // MESSAGE_EDIT
            console.log('[messages.update] Message edited:', key.id)
            const editedMsg = protocol.editedMessage
            if (editedMsg) {
              const textContent = editedMsg.conversation || editedMsg.extendedTextMessage?.text
                || editedMsg.imageMessage?.caption || editedMsg.videoMessage?.caption || null
              await this.prisma.message.update({
                where: { id: key.id },
                data: { content: JSON.stringify(editedMsg), textContent, isEdited: true }
              }).catch(() => { })
              if (mainWindow && !mainWindow.isDestroyed()) {
                const dbMsg = await this.prisma.message.findUnique({ where: { id: key.id } })
                if (dbMsg) {
                  const nameMap = await this.services.contactService.batchResolveNames([cleanJid(dbMsg.participant || dbMsg.chatJid)], sock)
                  const enriched = await this.services.messageService.enrichMessage(dbMsg, sock, nameMap)
                  mainWindow.webContents.send('message-edited', enriched)
                }
              }
            }
            break
          }
        }
      } catch (err) {
        console.error('[messages.update] Error processing update:', err)
      }
    }
  }

  async handleContactsUpsert(contacts: any[]): Promise<void> {
    for (const contact of contacts) {
      const cleanContact = {
        ...contact,
        id: cleanJid(contact.id),
        lid: contact.lid ? cleanJid(contact.lid) : undefined,
        phoneNumber: contact.phoneNumber ? cleanJid(contact.phoneNumber) : undefined
      }
      await this.services.contactService.upsertContact(cleanContact).catch(() => { })
      const raw = contact as any
      if (raw.lid && raw.id && !String(raw.id).endsWith('@lid') && String(raw.id).includes('@s.whatsapp.net')) {
        await this.services.contactService.linkLidAndPn(cleanJid(raw.lid), cleanJid(raw.id), 'contacts.upsert').catch(() => { })
      }
    }
  }

  async handleContactsUpdate(contacts: any[]): Promise<void> {
    for (const contact of contacts) {
      const cleanContact = {
        ...contact,
        id: cleanJid(contact.id),
        lid: contact.lid ? cleanJid(contact.lid) : undefined,
        phoneNumber: contact.phoneNumber ? cleanJid(contact.phoneNumber) : undefined
      }
      await this.services.contactService.upsertContact(cleanContact, { overwriteName: true }).catch(() => { })
    }
  }

  async handleLidMappingUpdate(mappings: any[]): Promise<void> {
    for (const mapping of mappings) {
      const { lid, pn } = mapping
      if (lid && pn) await this.services.contactService.linkLidAndPn(cleanJid(lid), cleanJid(pn), 'lid-mapping.update').catch(() => { })
    }
  }

  async handleChatsUpdate(updates: any[]): Promise<void> {
    const mainWindow = this.getMainWindow()
    for (const update of updates) {
      const jid = cleanJid(update.id)
      if (jid) {
        await this.services.chatService.upsertChat(jid, update).catch(() => { })
        if (mainWindow && !mainWindow.isDestroyed()) {
          const formatted: any = {}
          for (const [key, val] of Object.entries(update)) {
            formatted[key] = typeof val === 'bigint' ? val.toString() : val
          }
          mainWindow.webContents.send('chat-updated', { jid, ...formatted })
        }
      }
    }
  }

  async handleChatsUpsert(chats: any[]): Promise<void> {
    for (const chat of chats) {
      const jid = cleanJid(chat.id)
      if (jid) {
        // @ts-ignore
        const raw = { ...chat, ...(chat.metadata || {}) }
        await this.services.chatService.upsertChat(jid, raw).catch(() => { })
      }
    }
  }

  async handleGroupsUpdate(updates: any[]): Promise<void> {
    for (const update of updates) {
      const raw = update as any
      if (!raw.id) continue
      const cleanGroupId = cleanJid(raw.id)

      // Always upsert the chat
      await this.services.chatService.upsertChat(cleanGroupId, { ...raw, id: cleanGroupId }).catch(() => { })

      if (raw.participants && raw.participants.length > 0) {
        const cleanParticipants = raw.participants.map((p: any) => ({
          ...p,
          id: cleanJid(p.id || p.userJid)
        }))
        await this.services.chatService.syncGroupMembers(cleanGroupId, cleanParticipants).catch((err) => {
          console.error(`[groups.update] Failed to sync members for ${cleanGroupId}:`, err)
        })
      }
    }
  }

  async handleGroupParticipantsUpdate(data: any): Promise<void> {
    const { id, participants, action } = data
    const cleanGroupId = cleanJid(id)
    if (cleanGroupId && participants) {
      for (const jid of participants) {
        const cleanUserJid = cleanJid(jid)
        let identityId = await this.services.contactService.getIdentityIdByJid(cleanUserJid)
        if (!identityId) {
          await this.services.contactService.upsertContact({ id: cleanUserJid }).catch(() => { })
          identityId = await this.services.contactService.getIdentityIdByJid(cleanUserJid)
        }
        if (identityId) {
          if (action === 'add' || action === 'promote' || action === 'demote') {
            const role = action === 'promote' ? 'ADMIN' : 'MEMBER'
            await this.prisma.chatMember.upsert({
              where: { chatJid_identityId: { chatJid: cleanGroupId, identityId } },
              update: { role },
              create: { chatJid: cleanGroupId, identityId, role }
            }).catch(() => { })
          } else if (action === 'remove') {
            await this.prisma.chatMember.delete({
              where: { chatJid_identityId: { chatJid: cleanGroupId, identityId } }
            }).catch(() => { })
          }
        }
      }
    }
  }

  async handleMessagesReaction(reactions: any[], sock: WASocket): Promise<void> {
    const mainWindow = this.getMainWindow()
    for (const reactionUpdate of reactions) {
      await this.services.messageService.processReaction(reactionUpdate, sock, mainWindow).catch((err) => {
        console.error('[WhatsAppConnectionManager] Error processing messages.reaction:', err)
      })
    }
  }

  async handlePresenceUpdate(data: any, sock: WASocket): Promise<void> {
    const mainWindow = this.getMainWindow()
    const { id, presences } = data
    const cleanRemoteJid = cleanJid(id)
    if (mainWindow && !mainWindow.isDestroyed()) {
      const jids = Object.keys(presences).map(j => cleanJid(j))
      const nameMap = await this.services.contactService.batchResolveNames(jids, sock)
      const enrichedPresences = Object.entries(presences).map(([participantJid, status]) => {
        const cleanParticipantJid = cleanJid(participantJid)
        const s = status as any
        return [
          cleanParticipantJid,
          {
            ...s,
            name: nameMap.get(cleanParticipantJid) || cleanParticipantJid.replace(/@.*$/, ''),
            lastSeen: s.lastSeen ? s.lastSeen.toString() : undefined,
            timestamp: Date.now()
          }
        ]
      })
      mainWindow.webContents.send('presence-update', {
        remoteJid: cleanRemoteJid,
        presences: Object.fromEntries(enrichedPresences)
      })
    }
  }

  async handleMessageReceiptUpdate(updates: any[], sock: WASocket): Promise<void> {
    const mainWindow = this.getMainWindow()
    for (const update of updates) {
      const { key, receipt } = update as any
      const type = receipt?.readTimestamp
        ? 'read'
        : receipt?.deliveredTimestamp
        ? 'delivered'
        : 'unknown'
      console.log(
        `[message-receipt.update] ${type} | msgId=${key?.id} | chat=${key?.remoteJid} | by=${receipt?.userJid} | ts=${receipt?.readTimestamp ?? receipt?.deliveredTimestamp}`
      )
      await this.services.receiptService.processMessageReceipt(update, sock, mainWindow).catch(() => {})
    }
  }

  async handleCallEvent(calls: any[]): Promise<void> {
    for (const call of calls) {
      try {
        const rawCall = call as any
        const fromJid = rawCall.from
        const altPn = rawCall.callerPn || rawCall.content?.attrs?.['caller_pn'] || rawCall.attrs?.['caller_pn']
        const altLid = rawCall.content?.attrs?.['caller_lid'] || rawCall.attrs?.['caller_lid']
        
        const ids = [fromJid, altPn, altLid].filter(Boolean) as string[];
        let callLid: string | null = null;
        let callPn: string | null = null;
        
        for (const id of ids) {
           if (typeof id === 'string') {
             if (id.includes('@lid')) callLid = id;
             if (id.includes('@s.whatsapp.net')) callPn = id;
           }
        }

        if (callLid && callPn) {
          await this.services.contactService.linkLidAndPn(callLid, callPn, 'call.event').catch(() => {})
        }
      } catch (err) {
        console.error('[WhatsAppConnectionManager] Error processing call event:', err)
      }
    }
  }
}
