import { useState, useCallback, useEffect } from 'react'
import { AIChatSessionItem, AIChatMessage } from '../types'
import { useAPI } from '../context/APIContext'

export function useAIChatSessions() {
  const api = useAPI()
  const [sessions, setSessions] = useState<AIChatSessionItem[]>([])
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null)
  const [isHistoryModalOpen, setIsHistoryModalOpen] = useState(false)

  const refreshSessions = useCallback(async () => {
    try {
      const data = await api.listAiSessions(1, 50)
      setSessions(data)
    } catch (e) {
      console.error('Failed to list AI sessions:', e)
    }
  }, [])

  // Initial load
  useEffect(() => {
    refreshSessions()
  }, [refreshSessions])

  /**
   * Creates a new session for the given prompt.
   * IMPORTANT: Does NOT call setActiveSessionId — that would trigger a loadSession
   * useEffect in AIChatSidebar which would wipe the in-memory messages with an
   * empty DB result. The sidebar tracks the session ID via the returned value.
   */
  const createSession = async (firstPrompt: string, modelId?: string): Promise<string | null> => {
    try {
      const title = firstPrompt.length > 50 ? firstPrompt.substring(0, 50) + '...' : firstPrompt
      const session = await api.createAiSession(title, modelId)
      setActiveSessionId(session.id)
      await refreshSessions()
      return session.id
    } catch (e) {
      console.error('Failed to create AI session:', e)
      return null
    }
  }

  /**
   * Explicitly loads an existing session from history.
   * Called only when the user picks a session from the History Modal.
   */
  const selectSession = async (id: string): Promise<AIChatMessage[]> => {
    try {
      const session = await api.getAiSession(id)
      if (session) {
        setActiveSessionId(session.id)
        return session.messages
      }
    } catch (e) {
      console.error('Failed to load AI session:', e)
    }
    return []
  }

  const saveCurrentMessages = async (sessionId: string, messages: AIChatMessage[]) => {
    if (!sessionId || messages.length === 0) return
    try {
      await api.saveAiSessionMessages(sessionId, messages)
      await refreshSessions()
    } catch (e) {
      console.error('Failed to save AI session messages:', e)
    }
  }

  const renameSession = async (id: string, title: string) => {
    try {
      await api.renameAiSession(id, title)
      await refreshSessions()
    } catch (e) {
      console.error('Failed to rename AI session:', e)
    }
  }

  const deleteSession = async (id: string) => {
    try {
      await api.deleteAiSession(id)
      if (activeSessionId === id) {
        setActiveSessionId(null)
      }
      await refreshSessions()
    } catch (e) {
      console.error('Failed to delete AI session:', e)
    }
  }

  const cloneSession = async (id: string): Promise<any> => {
    try {
      const newSession = await api.cloneAiSession(id)
      await refreshSessions()
      return newSession
    } catch (e) {
      console.error('Failed to clone AI session:', e)
      return null
    }
  }

  const startNewChat = () => {
    setActiveSessionId(null)
  }

  return {
    sessions,
    activeSessionId,
    isHistoryModalOpen,
    setIsHistoryModalOpen,
    refreshSessions,
    createSession,
    selectSession,
    saveCurrentMessages,
    renameSession,
    deleteSession,
    cloneSession,
    startNewChat
  }
}

