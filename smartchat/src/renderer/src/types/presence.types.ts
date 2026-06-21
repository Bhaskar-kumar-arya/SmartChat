export interface PresenceEntry {
  lastKnownPresence: 'composing' | 'recording' | 'available' | 'unavailable' | string
  timestamp: number
  name?: string
}

export type PresenceMap = Record<string, PresenceEntry>

export interface PresenceUpdate {
  remoteJid: string
  presences: PresenceMap
}
