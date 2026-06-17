import { PrismaClient } from '@prisma/client'
import { cleanJid, parseBaileysTimestamp } from '../../utils'
import { WASocket, MessageReceiptUpdate, BaileysMessage } from '../../types'
import { ContactService } from '../contacts/ContactService'
import { WAEventBus } from './WAEventBus'

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

export class ReceiptService {
  private statusMap: Record<string, number> = {
    'PENDING': 0,
    'SENT': 1,
    'DELIVERED': 2,
    'READ': 3,
    'PLAYED': 4
  }

  constructor(
    private prisma: PrismaClient,
    private contactService: ContactService,
    private getBus: () => WAEventBus | null
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
      const currentMsg = await this.prisma.message.findUnique({
        where: { id: msgId }
      })

      if (!currentMsg) return

      const currentStatus = currentMsg.status || 'PENDING'
      const currentLevel = this.statusMap[currentStatus] ?? 0
      const newLevel = this.statusMap[newStatus] ?? 0

      if (newLevel > currentLevel) {
        await this.prisma.message.update({
          where: { id: msgId },
          data: { status: newStatus }
        })

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
    _sock: WASocket | null
  ): Promise<void> {
    const { key, receipt } = update
    const messageId = key?.id
    if (!messageId) return

    const remoteJid = cleanJid(key.remoteJid || '')
    const userJid = cleanJid(receipt?.userJid || remoteJid) // Default to remoteJid for DMs

    const isRead = !!receipt?.readTimestamp
    const isDelivered = !!receipt?.receiptTimestamp && !isRead
    const status = isRead ? 'READ' : (isDelivered ? 'DELIVERED' : 'SENT')

    try {
      const message = await this.prisma.message.findUnique({
        where: { id: messageId }
      })

      if (!message) return

      // Always save detailed individual receipt (especially for groups, but also useful for DMs)
      if (userJid) {
        const ts = parseBaileysTimestamp(receipt?.readTimestamp || receipt?.receiptTimestamp || Math.floor(Date.now() / 1000))
        await this.prisma.messageReceipt.upsert({
          where: {
            messageId_userJid: {
              messageId,
              userJid
            }
          },
          update: {
            status,
            timestamp: ts
          },
          create: {
            messageId,
            userJid,
            status,
            timestamp: ts
          }
        }).catch((e) => {
          console.error('[ReceiptService] Failed to upsert MessageReceipt:', e)
        })
      }

      const isGroup = remoteJid.endsWith('@g.us')

      if (isGroup) {
        // Fetch total number of members in the group from database
        const membersCount = await this.prisma.chatMember.count({
          where: { chatJid: remoteJid }
        })

        // Find how many other members have read the message
        const readCount = await this.prisma.messageReceipt.count({
          where: {
            messageId,
            status: 'READ'
          }
        })

        // In groups, the sender is one of the members. The number of other members is membersCount - 1
        if (membersCount > 1 && readCount >= membersCount - 1) {
          // If everyone read it
          const currentStatus = message.status || 'PENDING'
          if (currentStatus !== 'READ') {
            await this.prisma.message.update({
              where: { id: messageId },
              data: { status: 'READ' }
            })

            await this.getBus()?.emit('message:status-updated', {
              id: messageId,
              chatJid: remoteJid,
              status: 'READ'
            })
          }
        } else {
          // Check if everyone got it delivered
          const deliveredCount = await this.prisma.messageReceipt.count({
            where: {
              messageId,
              status: { in: ['DELIVERED', 'READ'] }
            }
          })

          if (membersCount > 1 && deliveredCount >= membersCount - 1) {
            const currentStatus = message.status || 'PENDING'
            const currentLevel = this.statusMap[currentStatus] ?? 0
            const newLevel = this.statusMap['DELIVERED']

            if (newLevel > currentLevel) {
              await this.prisma.message.update({
                where: { id: messageId },
                data: { status: 'DELIVERED' }
              })

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
              await this.prisma.message.update({
                where: { id: messageId },
                data: { status: 'SENT' }
              })

              await this.getBus()?.emit('message:status-updated', {
                id: messageId,
                chatJid: remoteJid,
                status: 'SENT'
              })
            }
          }
        }
      } else {
        // DM Chat: simply update to the highest status
        const currentStatus = message.status || 'PENDING'
        const currentLevel = this.statusMap[currentStatus] ?? 0
        const newLevel = this.statusMap[status] ?? 0

        if (newLevel > currentLevel) {
          await this.prisma.message.update({
            where: { id: messageId },
            data: { status }
          })

          await this.getBus()?.emit('message:status-updated', {
            id: messageId,
            chatJid: remoteJid,
            status
          })
        }
      }
    } catch (err) {
      console.error('[ReceiptService] Error processing message receipt:', err)
    }
  }

  /**
   * Retrieves message delivery/read receipts with resolved contact names.
   */
  public async getMessageReceipts(messageId: string, sock: WASocket | null): Promise<any[]> {
    const receipts = await this.prisma.messageReceipt.findMany({
      where: { messageId },
      orderBy: { timestamp: 'desc' }
    })
    const result: any[] = []
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
}
