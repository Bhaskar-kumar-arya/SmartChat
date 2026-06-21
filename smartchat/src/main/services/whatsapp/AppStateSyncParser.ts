/**
 * AppStateSyncParser.ts
 * =====================
 * Decouples the decoding, parsing, and domain event mapping logic of WhatsApp
 * app-state sync mutations from the main WAEventHandler.
 */

import { IWAEventBus } from './IWAEventBus'
import { WASocket } from './types'
import { cleanJid } from '../../utils'

export class AppStateSyncParser {
  /**
   * Decodes index arrays, detects sync action names, and dispatches the
   * corresponding typed event on the event bus.
   */
  static async parseAndDispatch(syncAction: unknown, sock: WASocket, bus: IWAEventBus): Promise<void> {
    try {
      const syncActionObj = syncAction as Record<string, unknown> | null | undefined
      if (!syncActionObj) return

      let indexArray: string[] | null = null
      if (Array.isArray(syncActionObj.index)) {
        indexArray = syncActionObj.index
      } else if (syncActionObj.syncAction && typeof (syncActionObj.syncAction as Record<string, unknown>).index === 'string') {
        const decoded = Buffer.from((syncActionObj.syncAction as Record<string, unknown>).index as string, 'base64').toString('utf8')
        const parsed = JSON.parse(decoded)
        if (Array.isArray(parsed)) {
          indexArray = parsed
        }
      }

      if (!indexArray || indexArray.length === 0) return

      const actionName = indexArray[0]
      const innerAction = syncActionObj.syncAction as Record<string, unknown> | null | undefined
      const value = innerAction?.value as Record<string, unknown> | null | undefined

      switch (actionName) {
        case 'favoriteSticker':
          await this.handleFavoriteSticker(indexArray, value, sock, bus)
          break
        case 'mute':
          await this.handleMute(indexArray, value, bus)
          break
        case 'pin':
        case 'pin_v1':
          await this.handlePin(indexArray, value, innerAction, bus)
          break
        case 'star':
          await this.handleStar(indexArray, value, bus)
          break
        case 'call_log':
          await this.handleCallLog(indexArray, value, bus)
          break
        case 'label_edit':
          await this.handleLabelEdit(indexArray, value, bus)
          break
        case 'lock':
          await this.handleLock(indexArray, value, bus)
          break
        case 'notificationActivitySetting':
          await this.handleNotificationSetting(indexArray, value, bus)
          break
        default:
          if (actionName.startsWith('setting_')) {
            const settingType = actionName.substring(8)
            await bus.emit('app-state:setting', {
              settingType,
              value
            })
          }
          break
      }
    } catch (err) {
      console.error('[AppStateSyncParser] Failed to parse and dispatch app-state sync action:', err)
    }
  }

  private static async handleFavoriteSticker(
    indexArray: string[],
    value: Record<string, unknown> | null | undefined,
    sock: WASocket,
    bus: IWAEventBus
  ): Promise<void> {
    const fileSha256 = indexArray[1]
    if (!fileSha256) return
    const stickerAction = value?.stickerAction as Record<string, unknown> | null | undefined
    const isFavorite = !!value && !!stickerAction && stickerAction.isFavorite !== false
    await bus.emit('app-state:favorite-sticker', {
      fileSha256,
      isFavorite,
      stickerAction: isFavorite ? stickerAction : undefined,
      sock
    })
  }

  private static async handleMute(
    indexArray: string[],
    value: Record<string, unknown> | null | undefined,
    bus: IWAEventBus
  ): Promise<void> {
    const chatJid = indexArray[1]
    if (!chatJid) return
    const cleanChatJid = cleanJid(chatJid)
    const muteAction = value?.muteAction as Record<string, unknown> | null | undefined
    const muted = !!muteAction?.muted
    let muteEndTimestamp: bigint | null = null
    if (muted && muteAction?.muteEndTimestamp !== undefined) {
      const val = muteAction.muteEndTimestamp
      muteEndTimestamp = BigInt(typeof val === 'string' ? val : String(val))
    }

    let muteSec = 0n
    if (muted) {
      if (muteEndTimestamp !== null && muteEndTimestamp !== undefined) {
        muteSec = muteEndTimestamp > 10000000000n ? muteEndTimestamp / 1000n : muteEndTimestamp
        if (muteSec === 0n) muteSec = -1n
      } else {
        muteSec = -1n
      }
    }

    await bus.emit('app-state:mute', {
      chatJid: cleanChatJid,
      muted,
      muteEndTimestamp
    })

    await bus.emit('chat:updated', {
      jid: cleanChatJid,
      update: {
        muteExpiration: muteSec
      }
    })
  }

  private static async handlePin(
    indexArray: string[],
    value: Record<string, unknown> | null | undefined,
    innerAction: Record<string, unknown> | null | undefined,
    bus: IWAEventBus
  ): Promise<void> {
    const chatJid = indexArray[1]
    if (!chatJid) return
    const cleanChatJid = cleanJid(chatJid)
    const pinAction = value?.pinAction as Record<string, unknown> | null | undefined
    const pinned = !!pinAction?.pinned
    const pinTimestamp = pinned ? (innerAction?.timestamp ? Number(innerAction.timestamp) : Math.floor(Date.now() / 1000)) : 0

    await bus.emit('chat:updated', {
      jid: cleanChatJid,
      update: {
        pinned: pinTimestamp
      }
    })
  }

  private static async handleStar(
    indexArray: string[],
    value: Record<string, unknown> | null | undefined,
    bus: IWAEventBus
  ): Promise<void> {
    const chatJid = indexArray[1]
    const messageId = indexArray[2]
    const fromMe = indexArray[3] === '1'
    const starAction = value?.starAction as Record<string, unknown> | null | undefined
    const starred = !!starAction?.starred
    if (chatJid && messageId) {
      await bus.emit('app-state:star', {
        chatJid,
        messageId,
        fromMe,
        starred
      })
    }
  }

  private static async handleCallLog(
    indexArray: string[],
    value: Record<string, unknown> | null | undefined,
    bus: IWAEventBus
  ): Promise<void> {
    const chatJid = indexArray[1]
    const callId = indexArray[2]
    const callLogRecord = (value?.callLogAction as Record<string, unknown> | undefined)?.callLogRecord as Record<string, unknown> | undefined
    if (chatJid && callId && callLogRecord) {
      const isIncoming = !!callLogRecord.isIncoming
      const duration = typeof callLogRecord.duration === 'string'
        ? parseInt(callLogRecord.duration, 10)
        : (typeof callLogRecord.duration === 'number' ? callLogRecord.duration : 0)
      const startTime = BigInt(
        typeof callLogRecord.startTime === 'string'
          ? callLogRecord.startTime
          : String(callLogRecord.startTime || 0)
      )
      const participants = Array.isArray(callLogRecord.participants)
        ? callLogRecord.participants.map((p: unknown) => {
          const pObj = p as Record<string, unknown> | null | undefined
          return {
            userJid: (pObj?.userJid as string | undefined) || '',
            callResult: (pObj?.callResult as string | undefined) || ''
          }
        })
        : []

      await bus.emit('app-state:call-log', {
        chatJid,
        callId,
        isIncoming,
        record: {
          callResult: (callLogRecord.callResult as string | undefined) || '',
          isDndMode: !!callLogRecord.isDndMode,
          silenceReason: (callLogRecord.silenceReason as string | undefined) || '',
          duration,
          startTime,
          isVideo: !!callLogRecord.isVideo,
          isCallLink: !!callLogRecord.isCallLink,
          callCreatorJid: (callLogRecord.callCreatorJid as string | undefined) || '',
          participants,
          callType: (callLogRecord.callType as string | undefined) || ''
        }
      })
    }
  }

  private static async handleLabelEdit(
    indexArray: string[],
    value: Record<string, unknown> | null | undefined,
    bus: IWAEventBus
  ): Promise<void> {
    const labelId = indexArray[1]
    const labelEditAction = value?.labelEditAction as Record<string, unknown> | null | undefined
    if (labelId && labelEditAction) {
      await bus.emit('app-state:label-edit', {
        labelId,
        name: (labelEditAction.name as string | undefined) || '',
        color: typeof labelEditAction.color === 'number' ? labelEditAction.color : 0,
        deleted: !!labelEditAction.deleted,
        isActive: !!labelEditAction.isActive,
        type: (labelEditAction.type as string | undefined) || ''
      })
    }
  }

  private static async handleLock(
    indexArray: string[],
    value: Record<string, unknown> | null | undefined,
    bus: IWAEventBus
  ): Promise<void> {
    const chatJid = indexArray[1]
    const lockChatAction = value?.lockChatAction as Record<string, unknown> | null | undefined
    if (chatJid && lockChatAction) {
      await bus.emit('app-state:lock', {
        chatJid,
        locked: !!lockChatAction.locked
      })
    }
  }

  private static async handleNotificationSetting(
    indexArray: string[],
    value: Record<string, unknown> | null | undefined,
    bus: IWAEventBus
  ): Promise<void> {
    const chatJid = indexArray[1]
    const notificationAction = value?.notificationActivitySettingAction as Record<string, unknown> | null | undefined
    if (chatJid && notificationAction) {
      await bus.emit('app-state:notification-setting', {
        chatJid,
        setting: (notificationAction.notificationActivitySetting as string | undefined) || ''
      })
    }
  }
}
