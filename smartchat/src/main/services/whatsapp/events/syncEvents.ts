import { WASocket } from '../types'

export interface AppStateSyncEvent {
  syncAction: unknown
  sock: WASocket
}

export interface FavoriteStickerSyncEvent {
  fileSha256: string
  isFavorite: boolean
  stickerAction?: unknown
  sock: WASocket
}

export interface MuteSyncEvent {
  chatJid: string
  muted: boolean
  muteEndTimestamp: bigint | null
}

export interface StarSyncEvent {
  chatJid: string
  messageId: string
  fromMe: boolean
  starred: boolean
}

export interface CallLogSyncEvent {
  chatJid: string
  callId: string
  isIncoming: boolean
  record: {
    callResult: string
    isDndMode: boolean
    silenceReason: string
    duration: number
    startTime: bigint
    isVideo: boolean
    isCallLink: boolean
    callCreatorJid: string
    participants: Array<{ userJid: string; callResult: string }>
    callType: string
  }
}

export interface LabelEditSyncEvent {
  labelId: string
  name: string
  color: number
  deleted: boolean
  isActive: boolean
  type: string
}

export interface SettingSyncEvent {
  settingType: string
  value: unknown
}

export interface LockSyncEvent {
  chatJid: string
  locked: boolean
}

export interface NotificationSettingSyncEvent {
  chatJid: string
  setting: string
}

export interface WASyncProgressPayload {
  progress: number
  syncType: number
  syncFullHistory: boolean
}

export type WASyncStatusPayload = string
export type WASyncCompletePayload = void
export type WAConnectedPayload = void

export interface SyncEventMap {
  'app-state:sync': AppStateSyncEvent
  'app-state:favorite-sticker': FavoriteStickerSyncEvent
  'app-state:mute': MuteSyncEvent
  'app-state:star': StarSyncEvent
  'app-state:call-log': CallLogSyncEvent
  'app-state:label-edit': LabelEditSyncEvent
  'app-state:setting': SettingSyncEvent
  'app-state:lock': LockSyncEvent
  'app-state:notification-setting': NotificationSettingSyncEvent
  'wa-sync-progress': WASyncProgressPayload
  'wa-sync-status': WASyncStatusPayload
  'wa-sync-complete': WASyncCompletePayload
  'wa-connected': WAConnectedPayload
}


