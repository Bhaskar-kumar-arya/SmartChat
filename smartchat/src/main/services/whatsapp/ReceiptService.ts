import { cleanJid } from '../../utils/jidUtils'
import { parseBaileysTimestamp } from '../../utils/messageUtils'
import { MessageReceiptUpdate, BaileysMessage } from './types'
import { IContactNameResolver, ISocketUserContext, IContactQueryService } from '../contacts/IContactService'
import { IWAEventBus } from './IWAEventBus'
import { IReceiptService } from './IReceiptService'
import { IReceiptRepository } from '../messages/IReceiptRepository'
import { Message } from '@prisma/client'

export function mapBaileysStatus(status: number | null | undefined): string {
  if (status === undefined || status === null) return 'SENT'
  switch (status) {
    case 1:
      return 'PENDING'
    case 2:
      return 'SENT' // SERVER_ACK
    case 3:
      return 'DELIVERED' // DELIVERY_ACK
    case 4:
    case 5:
      return 'READ' // READ / PLAYED
    default:
      return 'SENT'
  }
}

export class ReceiptService implements IReceiptService {
  private statusMap: Record<string, number> = {
    'PENDING': 0,
    'SENT': 1,
    'DELIVERED': 2,
    'READ': 3,
    'PLAYED': 4
  }

  constructor(
    private receiptRepository: IReceiptRepository,
    private contactService: IContactNameResolver & IContactQueryService,
    private getBus: () => IWAEventBus | null
  ) {}

  /**
   * Processes messages.update event to handle status changes (e.g. pending -> sent).
   */
  public async processMessageStatusUpdate(
    key: BaileysMessage['key'] | null | undefined,
    baileysStatus: number
  ): Promise<void> {
    const msgId = key?.id
    if (!msgId) return

    const newStatus = mapBaileysStatus(baileysStatus)

    try {
      const currentMsg = await this.receiptRepository.findMessageById(msgId)

      if (!currentMsg) return

      const currentStatus = currentMsg.status || 'PENDING'
      const currentLevel = this.statusMap[currentStatus] ?? 0
      const newLevel = this.statusMap[newStatus] ?? 0

      if (newLevel > currentLevel) {
        await this.receiptRepository.updateMessageStatus(msgId, newStatus)

        await this.getBus()?.emit('message:status-updated', {
          id: msgId,
          chatJid: currentMsg.chatJid,
          status: newStatus
        })
      }
    } catch (err) {
      console.error('[ReceiptService] Error processing message status update:', err)
    }
  }

  /**
   * Processes message-receipt.update event from Baileys to update delivery/read status.
   */
  public async processMessageReceipt(
    update: MessageReceiptUpdate,
    sock: ISocketUserContext | null
  ): Promise<void> {
    const { key, receipt } = update
    const messageId = key?.id
    if (!messageId) return

    const remoteJid = cleanJid(key.remoteJid || '')
    const userJid = cleanJid(receipt?.userJid || remoteJid) // Default to remoteJid for DMs
    const isUserSelf: boolean = await this.isSelfReceipt(userJid, sock)
    const isRemoteSelf: boolean = await this.isSelfReceipt(remoteJid, sock)

    if (isUserSelf && !isRemoteSelf) {
      return
    }

    const isRead = !!receipt?.readTimestamp
    const isDelivered = !!receipt?.receiptTimestamp && !isRead
    const status = isRead ? 'READ' : (isDelivered ? 'DELIVERED' : 'SENT')

    try {
      const message = await this.receiptRepository.findMessageById(messageId)

      if (!message) return

      // Always save detailed individual receipt (especially for groups, but also useful for DMs)
      if (userJid) {
        const ts = parseBaileysTimestamp(receipt?.readTimestamp || receipt?.receiptTimestamp || Math.floor(Date.now() / 1000))
        await this.receiptRepository.upsertMessageReceipt({
          messageId,
          userJid,
          status,
          timestamp: ts
        }).catch((e) => {
          console.error('[ReceiptService] Failed to upsert MessageReceipt:', e)
        })
      }

      const isGroup = remoteJid.endsWith('@g.us')

      if (isGroup) {
        await this.processGroupMessageReceipt(messageId, remoteJid, message)
      } else {
        await this.processDirectMessageReceipt(messageId, remoteJid, status, message)
      }
    } catch (err) {
      console.error('[ReceiptService] Error processing message receipt:', err)
    }
  }

  private async processGroupMessageReceipt(
    messageId: string,
    remoteJid: string,
    message: Message
  ): Promise<void> {
    // Fetch total number of members in the group from database
    const membersCount = await this.receiptRepository.getChatMembersCount(remoteJid)

    // Find how many other members have read the message
    const readCount = await this.receiptRepository.getMessageReceiptsCount(messageId, 'READ')

    // In groups, the sender is one of the members. The number of other members is membersCount - 1
    if (membersCount > 1 && readCount >= membersCount - 1) {
      // If everyone read it
      const currentStatus = message.status || 'PENDING'
      if (currentStatus !== 'READ') {
        await this.receiptRepository.updateMessageStatus(messageId, 'READ')

        await this.getBus()?.emit('message:status-updated', {
          id: messageId,
          chatJid: remoteJid,
          status: 'READ'
        })
      }
    } else {
      // Check if everyone got it delivered
      const deliveredCount = await this.receiptRepository.getMessageReceiptsWithStatusesCount(messageId, ['DELIVERED', 'READ'])

      if (membersCount > 1 && deliveredCount >= membersCount - 1) {
        const currentStatus = message.status || 'PENDING'
        const currentLevel = this.statusMap[currentStatus] ?? 0
        const newLevel = this.statusMap['DELIVERED']

        if (newLevel > currentLevel) {
          await this.receiptRepository.updateMessageStatus(messageId, 'DELIVERED')

          await this.getBus()?.emit('message:status-updated', {
            id: messageId,
            chatJid: remoteJid,
            status: 'DELIVERED'
          })
        }
      } else {
        // Keep status at SENT if not delivered to all yet
        const currentStatus = message.status || 'PENDING'
        if (currentStatus === 'PENDING') {
          await this.receiptRepository.updateMessageStatus(messageId, 'SENT')

          await this.getBus()?.emit('message:status-updated', {
            id: messageId,
            chatJid: remoteJid,
            status: 'SENT'
          })
        }
      }
    }
  }

  private async processDirectMessageReceipt(
    messageId: string,
    remoteJid: string,
    status: string,
    message: Message
  ): Promise<void> {
    const currentStatus = message.status || 'PENDING'
    const currentLevel = this.statusMap[currentStatus] ?? 0
    const newLevel = this.statusMap[status] ?? 0

    if (newLevel > currentLevel) {
      await this.receiptRepository.updateMessageStatus(messageId, status)

      await this.getBus()?.emit('message:status-updated', {
        id: messageId,
        chatJid: remoteJid,
        status
      })
    }
  }

  /**
   * Retrieves message delivery/read receipts with resolved contact names.
   */
  public async getMessageReceipts(
    messageId: string,
    sock: ISocketUserContext | null
  ): Promise<Array<{ userJid: string; name: string; status: string; timestamp: string }>> {
    const receipts = await this.receiptRepository.getMessageReceipts(messageId)
    const result: Array<{ userJid: string; name: string; status: string; timestamp: string }> = []
    for (const receipt of receipts) {
      const name = await this.contactService.resolveName(receipt.userJid, null, sock)
      result.push({
        userJid: receipt.userJid,
        name,
        status: receipt.status,
        timestamp: receipt.timestamp.toString()
      })
    }
    return result
  }

  private async isSelfReceipt(
    userJid: string,
    sock: ISocketUserContext | null
  ): Promise<boolean> {
    try {
      const meJids = await this.contactService.getMeJids(sock)
      return meJids.includes(userJid)
    } catch (err) {
      console.error('[ReceiptService] Failed to check if self receipt:', err)
      return false
    }
  }
}
