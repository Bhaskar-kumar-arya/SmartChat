/**
 * AppStateSyncParser.ts
 * =====================
 * Decouples the decoding, parsing, and domain event mapping logic of WhatsApp
 * app-state sync mutations from the main WAEventHandler.
 */

import { WAEventBus } from './WAEventBus'
import { WASocket } from '../../types'

export class AppStateSyncParser {
  /**
   * Decodes index arrays, detects sync action names, and dispatches the
   * corresponding typed event on the event bus.
   */
  static async parseAndDispatch(syncAction: any, sock: WASocket, bus: WAEventBus): Promise<void> {
    try {
      let indexArray: string[] | null = null
      if (Array.isArray(syncAction.index)) {
        indexArray = syncAction.index
      } else if (syncAction.syncAction && typeof syncAction.syncAction.index === 'string') {
        const decoded = Buffer.from(syncAction.syncAction.index, 'base64').toString('utf8')
        const parsed = JSON.parse(decoded)
        if (Array.isArray(parsed)) {
          indexArray = parsed
        }
      }

      if (!indexArray || indexArray.length === 0) return

      const actionName = indexArray[0]
      const innerAction = syncAction.syncAction
      const value = innerAction?.value

      switch (actionName) {
        case 'favoriteSticker': {
          const fileSha256 = indexArray[1]
          if (!fileSha256) break
          const stickerAction = value?.stickerAction
          const isFavorite = !!value && !!stickerAction && stickerAction.isFavorite !== false
          await bus.emit('app-state:favorite-sticker', {
            fileSha256,
            isFavorite,
            stickerAction: isFavorite ? stickerAction : undefined,
            sock
          })
          break
        }
        case 'mute': {
          const chatJid = indexArray[1]
          if (!chatJid) break
          const muteAction = value?.muteAction
          const muted = !!muteAction?.muted
          let muteEndTimestamp: bigint | null = null
          if (muted && muteAction?.muteEndTimestamp !== undefined) {
            const val = muteAction.muteEndTimestamp
            muteEndTimestamp = BigInt(typeof val === 'string' ? val : String(val))
          }
          await bus.emit('app-state:mute', {
            chatJid,
            muted,
            muteEndTimestamp
          })
          break
        }
        case 'star': {
          const chatJid = indexArray[1]
          const messageId = indexArray[2]
          const fromMe = indexArray[3] === '1'
          const starAction = value?.starAction
          const starred = !!starAction?.starred
          if (chatJid && messageId) {
            await bus.emit('app-state:star', {
              chatJid,
              messageId,
              fromMe,
              starred
            })
          }
          break
        }
        case 'call_log': {
          const chatJid = indexArray[1]
          const callId = indexArray[2]
          const callLogRecord = value?.callLogAction?.callLogRecord
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
              ? callLogRecord.participants.map((p: any) => ({
                userJid: p.userJid || '',
                callResult: p.callResult || ''
              }))
              : []

            await bus.emit('app-state:call-log', {
              chatJid,
              callId,
              isIncoming,
              record: {
                callResult: callLogRecord.callResult || '',
                isDndMode: !!callLogRecord.isDndMode,
                silenceReason: callLogRecord.silenceReason || '',
                duration,
                startTime,
                isVideo: !!callLogRecord.isVideo,
                isCallLink: !!callLogRecord.isCallLink,
                callCreatorJid: callLogRecord.callCreatorJid || '',
                participants,
                callType: callLogRecord.callType || ''
              }
            })
          }
          break
        }
        case 'label_edit': {
          const labelId = indexArray[1]
          const labelEditAction = value?.labelEditAction
          if (labelId && labelEditAction) {
            await bus.emit('app-state:label-edit', {
              labelId,
              name: labelEditAction.name || '',
              color: typeof labelEditAction.color === 'number' ? labelEditAction.color : 0,
              deleted: !!labelEditAction.deleted,
              isActive: !!labelEditAction.isActive,
              type: labelEditAction.type || ''
            })
          }
          break
        }
        case 'lock': {
          const chatJid = indexArray[1]
          const lockChatAction = value?.lockChatAction
          if (chatJid && lockChatAction) {
            await bus.emit('app-state:lock', {
              chatJid,
              locked: !!lockChatAction.locked
            })
          }
          break
        }
        case 'notificationActivitySetting': {
          const chatJid = indexArray[1]
          const notificationAction = value?.notificationActivitySettingAction
          if (chatJid && notificationAction) {
            await bus.emit('app-state:notification-setting', {
              chatJid,
              setting: notificationAction.notificationActivitySetting || ''
            })
          }
          break
        }
        default: {
          if (actionName.startsWith('setting_')) {
            const settingType = actionName.substring(8)
            await bus.emit('app-state:setting', {
              settingType,
              value
            })
          }
          break
        }
      }
    } catch (err) {
      console.error('[AppStateSyncParser] Failed to parse and dispatch app-state sync action:', err)
    }
  }
}
