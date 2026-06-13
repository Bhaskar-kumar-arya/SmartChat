/**
 * WAEventHandler
 * ==============
 * Thin dispatcher: receives raw Baileys event payloads, parses them into
 * typed domain events, and emits them on the WAEventBus.
 *
 * This class has ONE job: translate raw Baileys data → clean domain events.
 * It does NOT perform notifications, IPC sends, DB writes, or name resolution.
 * All of that lives in the subscribers (see subscribers/).
 */

import {
  WASocket,
  BaileysMessage,
  BaileysContact,
  BaileysGroupUpdate,
  BaileysReactionUpdate,
  BaileysCall,
  ChatUpdatePayload,
  MessageReceiptUpdate
} from '../../types'
import { cleanJid } from '../../utils'
import {
  PROTOCOL_TYPE_REVOKE,
  PROTOCOL_TYPE_EDIT
} from '../../constants'
import type { ServiceContainer } from '../../ServiceContainer'
import type { WAEventBus } from './WAEventBus'
import { AppStateSyncParser } from './AppStateSyncParser'

export class WAEventHandler {
  constructor(
    private services: ServiceContainer,
    private bus: WAEventBus
  ) {}

  // ── messages.upsert ───────────────────────────────────────────────────────

  async handleMessagesUpsert(
    data: { messages: BaileysMessage[]; type: string },
    sock: WASocket
  ): Promise<void> {
    const { messages, type } = data

    // 'append' = backlog catch-up after reconnect. Fast bulk path.
    if (type === 'append') {
      // 1. Bulk-persist standard messages first
      await this.bus.emit('messages:append', { messages, sock })

      // 2. Process special messages (edits, revokes, reactions) sequentially
      for (const msg of messages) {
        if (this.services.messageService.isSpecialMessage(msg)) {
          try {
            const processed = await this.services.messageService.processMessage(msg, sock)
            if (processed && 'type' in processed) {
              if (processed.subType === 'revoke') {
                await this.bus.emit('message:deleted', {
                  messageId: processed.targetId,
                  chatJid: processed.chatJid || cleanJid(processed.key.remoteJid),
                  fromMe: processed.key.fromMe ?? false
                })
              } else if (processed.subType === 'edit') {
                await this.bus.emit('message:edited', {
                  messageId: processed.targetId,
                  chatJid: processed.chatJid || cleanJid(processed.key?.remoteJid || ''),
                  editedTextContent: processed.editedTextContent ?? null,
                  editedContent: processed.editedContent ?? null,
                  sock
                })
              }
            }
          } catch (err) {
            console.error('[WAEventHandler] Error processing special message in backlog:', err)
          }
        }
      }
      return
    }

    // 'notify' = real-time new messages. Process individually.
    for (const msg of messages) {
      try {
        const processed = await this.services.messageService.processMessage(msg, sock)
        if (!processed) continue

        if ('type' in processed) {
          // Protocol messages: revoke or edit
          if (processed.subType === 'revoke') {
            await this.bus.emit('message:deleted', {
              messageId: processed.targetId,
              chatJid: processed.chatJid || cleanJid(processed.key.remoteJid),
              fromMe: processed.key.fromMe ?? false
            })
          } else if (processed.subType === 'edit') {
            await this.bus.emit('message:edited', {
              messageId: processed.targetId,
              chatJid: processed.chatJid || cleanJid(processed.key?.remoteJid || ''),
              editedTextContent: processed.editedTextContent ?? null,
              editedContent: processed.editedContent ?? null,
              sock
            })
          }
          continue
        }

        // Regular incoming message
        await this.bus.emit('message:incoming', {
          chatJid: processed.chatJid,
          senderJid: cleanJid(processed.participant || processed.chatJid),
          messageType: processed.messageType,
          textContent: processed.textContent,
          fromMe: processed.fromMe,
          timestamp: processed.timestamp,
          processed,
          sock
        })
      } catch (err) {
        console.error('[WAEventHandler] Error processing message in messages.upsert:', err)
      }
    }
  }

  // ── messages.update ───────────────────────────────────────────────────────

  async handleMessagesUpdate(updates: any[], sock: WASocket): Promise<void> {
    for (const update of updates) {
      try {
        // Status change (server ack, delivery, read)
        if (update.update?.status !== undefined && update.key?.id) {
          await this.bus.emit('message:status', {
            key: update.key,
            baileysStatus: update.update.status
          })
        }

        const protocol = update.update?.protocolMessage
        if (!protocol) continue
        const key = protocol.key
        if (!key?.id) continue

        const isRevoke = protocol.type === PROTOCOL_TYPE_REVOKE || protocol.type === 'REVOKE'
        const isEdit = protocol.type === PROTOCOL_TYPE_EDIT || protocol.type === 'MESSAGE_EDIT'

        if (isRevoke) {
          console.log('[WAEventHandler] Message revoked:', key.id)
          const chatJid = cleanJid(update.key?.remoteJid || key.remoteJid)
          await this.bus.emit('message:deleted', {
            messageId: key.id,
            chatJid,
            fromMe: key.fromMe ?? false
          })
        } else if (isEdit) {
          console.log('[WAEventHandler] Message edited:', key.id)
          const editedMsg = protocol.editedMessage
          if (editedMsg) {
            const textContent =
              editedMsg.conversation ||
              editedMsg.extendedTextMessage?.text ||
              editedMsg.imageMessage?.caption ||
              editedMsg.videoMessage?.caption ||
              null
            const chatJid = cleanJid(update.key?.remoteJid || key.remoteJid)
            await this.bus.emit('message:edited', {
              messageId: key.id,
              chatJid,
              editedTextContent: textContent,
              editedContent: editedMsg,
              sock
            })
          }
        }
      } catch (err) {
        console.error('[WAEventHandler] Error processing messages.update:', err)
      }
    }
  }

  // ── contacts ──────────────────────────────────────────────────────────────

  async handleContactsUpsert(contacts: BaileysContact[]): Promise<void> {
    await this.bus.emit('contact:upserted', { contacts })
  }

  async handleContactsUpdate(contacts: BaileysContact[]): Promise<void> {
    await this.bus.emit('contact:updated', { contacts })
  }

  async handleLidMappingUpdate(mappings: any[]): Promise<void> {
    const parsed = mappings
      .filter(m => m.lid && m.pn)
      .map(m => ({ lid: m.lid as string, pn: m.pn as string }))
    await this.bus.emit('lid:mapped', { mappings: parsed })
  }

  // ── chats ─────────────────────────────────────────────────────────────────

  async handleChatsUpdate(updates: ChatUpdatePayload[]): Promise<void> {
    for (const update of updates) {
      const jid = cleanJid(update.id)
      if (jid) {
        await this.bus.emit('chat:updated', { jid, update })
      }
    }
  }

  async handleChatsUpsert(chats: ChatUpdatePayload[]): Promise<void> {
    for (const chat of chats) {
      const jid = cleanJid(chat.id)
      if (jid) {
        // @ts-ignore
        const raw = { ...chat, ...(chat.metadata || {}) }
        await this.bus.emit('chat:upserted', { jid, raw })
      }
    }
  }

  // ── groups ────────────────────────────────────────────────────────────────

  async handleGroupsUpdate(updates: BaileysGroupUpdate[]): Promise<void> {
    await this.bus.emit('group:updated', { updates })
  }

  async handleGroupParticipantsUpdate(data: { id: string; participants: string[]; action: string }): Promise<void> {
    await this.bus.emit('group:participants', {
      id: data.id,
      participants: data.participants,
      action: data.action
    })
  }

  // ── reactions, presence, receipts, calls ─────────────────────────────────

  async handleMessagesReaction(reactions: BaileysReactionUpdate[], sock: WASocket): Promise<void> {
    await this.bus.emit('reaction:update', { reactions, sock })
  }

  async handlePresenceUpdate(data: { id: string; presences: Record<string, any> }, sock: WASocket): Promise<void> {
    await this.bus.emit('presence:update', {
      id: data.id,
      presences: data.presences,
      sock
    })
  }

  async handleMessageReceiptUpdate(updates: MessageReceiptUpdate[], sock: WASocket): Promise<void> {
    await this.bus.emit('receipt:update', { updates, sock })
  }

  async handleCallEvent(calls: BaileysCall[]): Promise<void> {
    await this.bus.emit('call:event', { calls })
  }

  async handleAppStateSync(syncEvents: any[], sock: WASocket): Promise<void> {
    for (const e of syncEvents) {
      // 1. Emit generic/raw event first
      await this.bus.emit('app-state:sync', { syncAction: e, sock })

      // 2. Parse specific actions and emit typed domain events via decoupled parser
      await AppStateSyncParser.parseAndDispatch(e, sock, this.bus)
    }
  }
}
