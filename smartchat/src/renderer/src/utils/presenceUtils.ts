import { ChatItem, PresenceMap } from '../types'

/**
 * Formats the active presence status (composing/recording) for a given chat.
 * Returns a formatting label if any member is typing/recording, or null otherwise.
 */
export function getPresenceStatusText(chat: ChatItem, presence: PresenceMap | undefined): string | null {
  if (!presence) return null

  const entries = Object.entries(presence)
  const composing = entries.filter(([_, s]) => s.lastKnownPresence === 'composing')
  const recording = entries.filter(([_, s]) => s.lastKnownPresence === 'recording')

  const isGroup = chat.jid.endsWith('@g.us')

  if (composing.length > 0) {
    if (isGroup) {
      if (composing.length === 1) {
        return `${composing[0][1].name || composing[0][0].split('@')[0]} typing...`
      }
      return `${composing.length} typing...`
    }
    return 'typing...'
  }

  if (recording.length > 0) {
    if (isGroup) {
      if (recording.length === 1) {
        return `${recording[0][1].name || recording[0][0].split('@')[0]} recording...`
      }
      return `${recording.length} recording...`
    }
    return 'recording...'
  }

  return null
}
