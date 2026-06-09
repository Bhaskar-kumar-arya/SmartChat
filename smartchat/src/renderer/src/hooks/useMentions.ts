import { useState, useEffect, useCallback } from 'react'
import { useAPI } from '../context/APIContext'

interface Participant {
  jid: string
  name: string
  isAdmin: boolean
  isMe: boolean
}

/**
 * Hook to manage mentions within a text input.
 * Handles fetching participants and tracking the mention query.
 */
export const useMentions = (activeJid: string | null) => {
  const api = useAPI()
  const [participants, setParticipants] = useState<Participant[]>([])
  const [showMenu, setShowMenu] = useState(false)
  const [query, setQuery] = useState('')
  const [mentionedJids, setMentionedJids] = useState<Set<string>>(new Set())

  const fetchParticipants = useCallback(async () => {
    if (!activeJid || !activeJid.endsWith('@g.us')) {
      setParticipants([])
      return
    }
    try {
      const parts = await api.getGroupParticipants(activeJid)
      setParticipants(parts)
    } catch (err) {
      console.error('Failed to fetch participants:', err)
      setParticipants([])
    }
  }, [activeJid])

  useEffect(() => {
    fetchParticipants()
    setShowMenu(false)
    setMentionedJids(new Set())
  }, [activeJid, fetchParticipants])

  const handleInputChange = useCallback((text: string, cursorPosition: number) => {
    const textBeforeCursor = text.slice(0, cursorPosition)
    const lastAtPos = textBeforeCursor.lastIndexOf('@')

    if (lastAtPos !== -1) {
      const textAfterAt = textBeforeCursor.slice(lastAtPos + 1)
      // Only show menu if there's no space between @ and cursor
      if (!textAfterAt.includes(' ')) {
        setShowMenu(true)
        setQuery(textAfterAt)
        return
      }
    }
    setShowMenu(false)
    setQuery('')
  }, [])

  const addMention = (participant: Participant) => {
    setMentionedJids(prev => new Set(prev).add(participant.jid))
    setShowMenu(false)
    setQuery('')
  }

  const clearMentions = () => {
    setMentionedJids(new Set())
  }

  return {
    participants,
    showMenu,
    query,
    mentionedJids,
    handleInputChange,
    addMention,
    clearMentions,
    setShowMenu
  }
}
