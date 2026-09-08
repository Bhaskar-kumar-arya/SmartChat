import { useEffect, useState, useCallback } from 'react'
import { useAPI } from '../context/APIContext'
import { PresenceMap, PresenceUpdate } from '../types/chatTypes'
import { isSameJid } from '../utils/jidUtils'

// `available` / `online` presence is aged out after this long without a refresh.
// The backend does not reliably push an `unavailable` presence when a contact
// goes offline, so without a TTL the header/list show a stale "online" forever (F3-06).
const AVAILABLE_TTL_MS = 60000
const TYPING_TTL_MS = 10000

/**
 * Hook to manage real-time presence updates and their automatic expiration.
 * This satisfies the Single Responsibility Principle.
 */
export const usePresence = () => {
  const api = useAPI()
  const [presences, setPresences] = useState<Record<string, PresenceMap>>({})

  useEffect(() => {
    const unSub = api.onPresenceUpdate((update: PresenceUpdate) => {
      setPresences((prev) => {
        const currentRemotePresence = prev[update.remoteJid] || {}
        return {
          ...prev,
          [update.remoteJid]: {
            ...currentRemotePresence,
            ...update.presences
          }
        }
      })
    })

    const interval = setInterval(() => {
      setPresences((prev) => {
        const now = Date.now()
        let changed = false
        const next = { ...prev }
        
        for (const jid of Object.keys(next)) {
          const pMap = { ...next[jid] }
          let subChanged = false
          for (const subJid of Object.keys(pMap)) {
            const s = pMap[subJid]
            const isTyping = s.lastKnownPresence === 'composing' || s.lastKnownPresence === 'recording'
            if (isTyping && s.timestamp && now - s.timestamp > TYPING_TTL_MS) {
              pMap[subJid] = { ...s, lastKnownPresence: 'available' }
              subChanged = true
              changed = true
            } else if (
              s.lastKnownPresence === 'available' &&
              s.timestamp &&
              now - s.timestamp > AVAILABLE_TTL_MS
            ) {
              pMap[subJid] = { ...s, lastKnownPresence: 'unavailable' }
              subChanged = true
              changed = true
            }
          }
          if (subChanged) next[jid] = pMap
        }
        return changed ? next : prev
      })
    }, 2000)

    return () => {
      unSub()
      clearInterval(interval)
    }
  }, [])

  // Presence is stored keyed by the raw `update.remoteJid`, which can differ in
  // case / `:device` / `@lid` form from the `activeJid` / `chat.jid` used for
  // lookup. Every other part of the chat layer compares JIDs with `isSameJid`;
  // do the same here so the indicator doesn't silently never appear (F3-07).
  const lookupPresence = useCallback(
    (jid: string | null | undefined): PresenceMap | undefined => {
      if (!jid) return undefined
      if (presences[jid]) return presences[jid]
      const key = Object.keys(presences).find((k) => isSameJid(k, jid))
      return key ? presences[key] : undefined
    },
    [presences]
  )

  const getActivePresence = useCallback((jid: string | null) => {
    const presenceMap = jid ? lookupPresence(jid) : undefined
    if (!jid || !presenceMap) return null
    const entries = Object.entries(presenceMap)
    
    const composing = entries.filter(([_, s]) => s.lastKnownPresence === 'composing')
    const recording = entries.filter(([_, s]) => s.lastKnownPresence === 'recording')
    
    if (composing.length > 0) {
      if (jid.endsWith('@g.us')) {
        if (composing.length === 1) return `${composing[0][1].name || composing[0][0].split('@')[0]} is typing...`
        return `${composing.length} people are typing...`
      }
      return 'typing...'
    }
    
    if (recording.length > 0) {
      if (jid.endsWith('@g.us')) {
        if (recording.length === 1) return `${recording[0][1].name || recording[0][0].split('@')[0]} is recording audio...`
        return `${recording.length} people are recording audio...`
      }
      return 'recording audio...'
    }

    if (entries.some(([_, s]) => s.lastKnownPresence === 'available' || s.lastKnownPresence === 'composing' || s.lastKnownPresence === 'recording')) {
      return 'online'
    }
    
    return null
  }, [lookupPresence])

  return { presences, getActivePresence, lookupPresence }
}
