import { BrowserWindow } from 'electron'
import { prisma } from '../auth'
import { cleanJid } from '../utils'

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

  /**
   * Processes messages.update event to handle status changes (e.g. pending -> sent).
   */
  public async processMessageStatusUpdate(
    key: any,
    baileysStatus: number,
    mainWindow: BrowserWindow | null
  ) {
    const msgId = key?.id
    if (!msgId) return

    const newStatus = mapBaileysStatus(baileysStatus)

    try {
      const currentMsg = await prisma.message.findUnique({
        where: { id: msgId }
      })

      if (!currentMsg) return

      const currentStatus = currentMsg.status || 'PENDING'
      const currentLevel = this.statusMap[currentStatus] ?? 0
      const newLevel = this.statusMap[newStatus] ?? 0

      if (newLevel > currentLevel) {
        await prisma.message.update({
          where: { id: msgId },
          data: { status: newStatus }
        })

        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send('message-status-updated', {
            id: msgId,
            remoteJid: currentMsg.chatJid,
            status: newStatus
          })
        }
      }
    } catch (err) {
      console.error('[ReceiptService] Error processing message status update:', err)
    }
  }

  /**
   * Processes message-receipt.update event from Baileys to update delivery/read status.
   */
  public async processMessageReceipt(
    update: any,
    _sock: any,
    mainWindow: BrowserWindow | null
  ) {
    const { key, receipt } = update
    const messageId = key?.id
    if (!messageId) return

    const remoteJid = cleanJid(key.remoteJid || '')
    const userJid = cleanJid(receipt?.userJid || remoteJid) // Default to remoteJid for DMs

    const isRead = !!receipt?.readTimestamp
    const isDelivered = !!receipt?.receiptTimestamp && !isRead
    const status = isRead ? 'READ' : (isDelivered ? 'DELIVERED' : 'SENT')

    try {
      const message = await prisma.message.findUnique({
        where: { id: messageId }
      })

      if (!message) return

      // Always save detailed individual receipt (especially for groups, but also useful for DMs)
      if (userJid) {
        const ts = receipt?.readTimestamp || receipt?.receiptTimestamp || Math.floor(Date.now() / 1000)
        await (prisma as any).messageReceipt.upsert({
          where: {
            messageId_userJid: {
              messageId,
              userJid
            }
          },
          update: {
            status,
            timestamp: BigInt(ts)
          },
          create: {
            messageId,
            userJid,
            status,
            timestamp: BigInt(ts)
          }
        }).catch((e) => {
          console.error('[ReceiptService] Failed to upsert MessageReceipt:', e)
        })
      }

      const isGroup = remoteJid.endsWith('@g.us')

      if (isGroup) {
        // Fetch total number of members in the group from database
        const membersCount = await prisma.chatMember.count({
          where: { chatJid: remoteJid }
        })

        // Find how many other members have read the message
        const readCount = await (prisma as any).messageReceipt.count({
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
            await prisma.message.update({
              where: { id: messageId },
              data: { status: 'READ' }
            })

            if (mainWindow && !mainWindow.isDestroyed()) {
              mainWindow.webContents.send('message-status-updated', {
                id: messageId,
                remoteJid,
                status: 'READ'
              })
            }
          }
        } else {
          // Check if everyone got it delivered
          const deliveredCount = await (prisma as any).messageReceipt.count({
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
              await prisma.message.update({
                where: { id: messageId },
                data: { status: 'DELIVERED' }
              })

              if (mainWindow && !mainWindow.isDestroyed()) {
                mainWindow.webContents.send('message-status-updated', {
                  id: messageId,
                  remoteJid,
                  status: 'DELIVERED'
                })
              }
            }
          } else {
            // Keep status at SENT if not delivered to all yet
            const currentStatus = message.status || 'PENDING'
            if (currentStatus === 'PENDING') {
              await prisma.message.update({
                where: { id: messageId },
                data: { status: 'SENT' }
              })

              if (mainWindow && !mainWindow.isDestroyed()) {
                mainWindow.webContents.send('message-status-updated', {
                  id: messageId,
                  remoteJid,
                  status: 'SENT'
                })
              }
            }
          }
        }
      } else {
        // DM Chat: simply update to the highest status
        const currentStatus = message.status || 'PENDING'
        const currentLevel = this.statusMap[currentStatus] ?? 0
        const newLevel = this.statusMap[status] ?? 0

        if (newLevel > currentLevel) {
          await prisma.message.update({
            where: { id: messageId },
            data: { status }
          })

          if (mainWindow && !mainWindow.isDestroyed()) {
            mainWindow.webContents.send('message-status-updated', {
              id: messageId,
              remoteJid,
              status
            })
          }
        }
      }
    } catch (err) {
      console.error('[ReceiptService] Error processing message receipt:', err)
    }
  }
}

export const receiptService = new ReceiptService()
