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
} from './types'
import { cleanJid } from '../../utils/jidUtils'
import { unwrapMessage, getMessageType, extractTextContent } from '../../utils/messageUtils'
import {
  PROTOCOL_TYPE_REVOKE,
  PROTOCOL_TYPE_EDIT
} from '../../constants'
import { IMessageParserService } from '../messages/IMessageParserService'
import { IMessageProcessingService } from '../messages/IMessageProcessingService'
import type { IWAEventBus } from './IWAEventBus'
import { AppStateSyncParser } from './AppStateSyncParser'
import { proto } from '@whiskeysockets/baileys'

const TYPE_APPEND = 'append';
const SUBTYPE_REVOKE = 'revoke';
const SUBTYPE_EDIT = 'edit';
const PROTOCOL_REVOKE_STRING = 'REVOKE';
const PROTOCOL_EDIT_STRING = 'MESSAGE_EDIT';
const MUTE_TIMESTAMP_THRESHOLD = 10000000000;
const MULTIPLIER_32BIT = 4294967296;
const MS_IN_SEC = 1000;

/**
 * WAEventHandler translates raw Baileys socket event payloads into domain events on the WAEventBus.
 *
 * Error handling contract:
 * - Emits failures silently via console.error with [WAEventHandler] prefix for individual message parsing errors
 *   to ensure a single corrupted message doesn't crash socket event processing.
 */
export class WAEventHandler {
  constructor(
    private messageProcessingService: IMessageProcessingService,
    private messageParserService: IMessageParserService,
    private bus: IWAEventBus
  ) {}

  // ── messages.upsert ───────────────────────────────────────────────────────

  async handleMessagesUpsert(
    data: { messages: BaileysMessage[]; type: string },
    sock: WASocket
  ): Promise<void> {
    const { messages, type } = data

    if (type === TYPE_APPEND) {
      await this.processBacklogMessages(messages, sock)
      return
    }

    for (const msg of messages) {
      try {
        await this.processRealtimeMessage(msg, sock)
      } catch (err) {
        console.error('[WAEventHandler] Error processing message in messages.upsert:', err)
      }
    }
  }

  private async processBacklogMessages(messages: BaileysMessage[], sock: WASocket): Promise<void> {
    // 1. Bulk-persist standard messages first
    await this.bus.emit('messages:append', { messages, sock })

    // 2. Process special messages (edits, revokes, reactions) sequentially
    for (const msg of messages) {
      if (!this.messageParserService.isSpecialMessage(msg)) continue
      try {
        const processed = await this.messageProcessingService.processMessage(msg, sock)
        if (processed) {
          await this.handleProcessedSpecialMessage(processed, sock)
        }
      } catch (err) {
        console.error('[WAEventHandler] Error processing special message in backlog:', err)
      }
    }
  }

  private async processRealtimeMessage(msg: BaileysMessage, sock: WASocket): Promise<void> {
    const processed = await this.messageProcessingService.processMessage(msg, sock)
    if (!processed) return

    if ('type' in processed) {
      await this.handleProcessedSpecialMessage(processed, sock)
      return
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
  }

  private async handleProcessedSpecialMessage(processed: unknown, sock: WASocket): Promise<void> {
    const procObj = processed as Record<string, unknown>
    if (procObj.subType === SUBTYPE_REVOKE) {
      await this.bus.emit('message:deleted', {
        messageId: procObj.targetId as string,
        chatJid: (procObj.chatJid as string | undefined) || cleanJid((procObj.key as proto.IMessageKey | undefined)?.remoteJid),
        fromMe: (procObj.key as proto.IMessageKey | undefined)?.fromMe ?? false
      })
    } else if (procObj.subType === SUBTYPE_EDIT) {
      await this.bus.emit('message:edited', {
        messageId: procObj.targetId as string,
        chatJid: (procObj.chatJid as string | undefined) || cleanJid((procObj.key as proto.IMessageKey | undefined)?.remoteJid || ''),
        editedTextContent: (procObj.editedTextContent as string | undefined) ?? null,
        editedContent: (procObj.editedContent as proto.IMessage | undefined) ?? null,
        sock
      })
    }
  }

  // ── messages.update ───────────────────────────────────────────────────────

  async handleMessagesUpdate(updates: unknown[], sock: WASocket): Promise<void> {
    for (const update of updates) {
      try {
        await this.handleMessageUpdateItem(update, sock)
      } catch (err) {
        console.error('[WAEventHandler] Error processing messages.update:', err)
      }
    }
  }

  private async handleMessageUpdateItem(update: unknown, sock: WASocket): Promise<void> {
    const updateObj = update as Record<string, unknown>
    const itemUpdate = updateObj.update as Record<string, unknown> | null | undefined
    const itemKey = updateObj.key as proto.IMessageKey | null | undefined

    await this.tryEmitStatusUpdate(itemKey, itemUpdate)
    await this.tryEmitDecryptedMessage(itemKey, itemUpdate, sock)
    await this.tryEmitProtocolMessage(itemKey, itemUpdate, sock)
  }

  private async tryEmitStatusUpdate(
    itemKey: proto.IMessageKey | null | undefined,
    itemUpdate: Record<string, unknown> | null | undefined
  ): Promise<void> {
    if (itemUpdate?.status !== undefined && itemKey?.id) {
      await this.bus.emit('message:status', {
        key: {
          id: itemKey.id,
          remoteJid: itemKey.remoteJid ?? null,
          fromMe: itemKey.fromMe ?? false
        },
        baileysStatus: itemUpdate.status as number
      })
    }
  }

  private async tryEmitDecryptedMessage(
    itemKey: proto.IMessageKey | null | undefined,
    itemUpdate: Record<string, unknown> | null | undefined,
    sock: WASocket
  ): Promise<void> {
    if (itemUpdate?.message && !itemUpdate?.protocolMessage && itemKey?.id) {
      const messageId = itemKey.id
      const chatJid = cleanJid(itemKey.remoteJid)

      let rawMessage: Record<string, unknown> | null = null
      try {
        rawMessage = JSON.parse(JSON.stringify(itemUpdate.message))
      } catch {
        rawMessage = itemUpdate.message as Record<string, unknown>
      }

      const unwrapped = rawMessage ? unwrapMessage(rawMessage) : null
      const messageType = unwrapped ? getMessageType(unwrapped) : 'unknown'

      if (messageType !== 'senderKeyDistributionMessage') {
        const textContent = extractTextContent(unwrapped)
        await this.bus.emit('message:decrypted', {
          messageId,
          chatJid,
          messageType,
          textContent,
          content: rawMessage ?? {},
          sock
        })
      }
    }
  }

  private async tryEmitProtocolMessage(
    itemKey: proto.IMessageKey | null | undefined,
    itemUpdate: Record<string, unknown> | null | undefined,
    sock: WASocket
  ): Promise<void> {
    const protocol = itemUpdate?.protocolMessage as proto.Message.IProtocolMessage | null | undefined
    if (!protocol) return
    const key = protocol.key
    if (!key?.id) return

    const protocolType = protocol.type as unknown as number | string
    const isRevoke = protocolType === PROTOCOL_TYPE_REVOKE || protocolType === PROTOCOL_REVOKE_STRING
    const isEdit = protocolType === PROTOCOL_TYPE_EDIT || protocolType === PROTOCOL_EDIT_STRING

    if (isRevoke) {
      console.log('[WAEventHandler] Message revoked:', key.id)
      const chatJid = cleanJid(itemKey?.remoteJid || key.remoteJid)
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
        const chatJid = cleanJid(itemKey?.remoteJid || key.remoteJid)
        await this.bus.emit('message:edited', {
          messageId: key.id,
          chatJid,
          editedTextContent: textContent,
          editedContent: editedMsg,
          sock
        })
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

  async handleLidMappingUpdate(mappings: unknown): Promise<void> {
    const arr = Array.isArray(mappings) ? mappings : [mappings]
    const parsed: { lid: string; pn: string }[] = []
    for (const m of arr) {
      if (m && typeof m === 'object' && 'lid' in m && 'pn' in m) {
        const item = m as { lid: unknown; pn: unknown }
        if (typeof item.lid === 'string' && typeof item.pn === 'string') {
          parsed.push({ lid: item.lid, pn: item.pn })
        }
      }
    }
    await this.bus.emit('lid:mapped', { mappings: parsed })
  }

  // ── chats ─────────────────────────────────────────────────────────────────

  async handleChatsUpdate(updates: ChatUpdatePayload[]): Promise<void> {
    for (const update of updates) {
      const jid = cleanJid(update.id)
      if (jid) {
        const normalizedUpdate: Record<string, unknown> = { ...update }
        const rawMute = update.muteExpiration !== undefined ? update.muteExpiration : update.muteEndTime
        if (rawMute !== undefined) {
          let muteSec = 0
          if (rawMute !== null) {
            const num = getNumericValue(rawMute)
            if (!isNaN(num)) {
              muteSec = num > MUTE_TIMESTAMP_THRESHOLD ? Math.floor(num / MS_IN_SEC) : num
            }
          }
          normalizedUpdate.muteExpiration = muteSec
        }
        await this.bus.emit('chat:updated', { jid, update: normalizedUpdate })
      }
    }
  }

  async handleChatsUpsert(chats: ChatUpdatePayload[]): Promise<void> {
    for (const chat of chats) {
      const jid = cleanJid(chat.id)
      if (jid) {
        // @ts-ignore
        const raw: Record<string, unknown> = { ...chat, ...(chat.metadata || {}) }
        const rawMute = raw.muteExpiration !== undefined ? raw.muteExpiration : raw.muteEndTime
        if (rawMute !== undefined) {
          let muteSec = 0
          if (rawMute !== null) {
            const num = getNumericValue(rawMute)
            if (!isNaN(num)) {
              muteSec = num > MUTE_TIMESTAMP_THRESHOLD ? Math.floor(num / MS_IN_SEC) : num
            }
          }
          raw.muteExpiration = muteSec
        }
        await this.bus.emit('chat:upserted', { jid, raw })
      }
    }
  }

  // ── groups ────────────────────────────────────────────────────────────────

  async handleGroupsUpdate(updates: BaileysGroupUpdate[]): Promise<void> {
    await this.bus.emit('group:updated', { updates })
  }

  async handleGroupParticipantsUpdate(data: { id: string; participants: unknown[]; action: string }): Promise<void> {
    const participants = data.participants.map(p => {
      if (typeof p === 'string') return p
      if (p && typeof p === 'object' && 'id' in p) {
        const item = p as { id: unknown }
        if (typeof item.id === 'string') return item.id
      }
      return ''
    }).filter(Boolean)

    await this.bus.emit('group:participants', {
      id: data.id,
      participants,
      action: data.action
    })
  }

  // ── reactions, presence, receipts, calls ─────────────────────────────────

  async handleMessagesReaction(reactions: BaileysReactionUpdate[], sock: WASocket): Promise<void> {
    await this.bus.emit('reaction:update', { reactions, sock })
  }

  async handlePresenceUpdate(data: { id: string; presences: Record<string, unknown> }, sock: WASocket): Promise<void> {
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

  async handleAppStateSync(syncEvents: unknown[], sock: WASocket): Promise<void> {
    for (const e of syncEvents) {
      // 1. Emit generic/raw event first
      await this.bus.emit('app-state:sync', { syncAction: e, sock })

      // 2. Parse specific actions and emit typed domain events via decoupled parser
      await AppStateSyncParser.parseAndDispatch(e, sock, this.bus)
    }
  }
}

function getNumericValue(val: unknown): number {
  if (val === undefined || val === null) return 0
  if (typeof val === 'object') {
    const obj = val as Record<string, unknown>
    if (typeof obj.toNumber === 'function') {
      return (obj.toNumber as () => number)()
    }
    if ('low' in obj && 'high' in obj) {
      const low = obj.low as number
      const high = obj.high as number
      return high * MULTIPLIER_32BIT + (low >>> 0)
    }
  }
  return Number(val)
}
