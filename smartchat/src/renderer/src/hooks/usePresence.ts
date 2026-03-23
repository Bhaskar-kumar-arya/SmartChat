import { useEffect, useState, useCallback } from 'react'
import { api } from '../services/api.service'

/**
 * Hook to manage real-time presence updates and their automatic expiration.
 * This satisfies the Single Responsibility Principle.
 */
export const usePresence = () => {
  const [presences, setPresences] = useState<Record<string, any>>({})

  useEffect(() => {
    const unSub = api.onPresenceUpdate((update) => {
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
            if (isTyping && s.timestamp && now - s.timestamp > 10000) {
              pMap[subJid] = { ...s, lastKnownPresence: 'available' }
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

  const getActivePresence = useCallback((jid: string | null) => {
    if (!jid || !presences[jid]) return null
    const presenceMap = presences[jid]
    const entries = Object.entries(presenceMap) as [string, any][]
    
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
  }, [presences])

  return { presences, getActivePresence }
}
