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
