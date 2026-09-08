import { useCallback } from 'react'
import { navigate } from '../utils/navigationBus'

/**
 * Provides imperative navigation methods usable from any component
 * without coupling to ChatLayout's internal state.
 *
 * Mechanism: routes through the app navigation bus (`utils/navigationBus`),
 * which retains the last intent and replays it when a listener mounts — so an
 * intent fired before `ChatLayout` is mounted (or during its listener churn on
 * a chat switch) is no longer dropped (F12-02). Supersedes the minimal F4-04
 * fix to the raw window-event listener.
 */
export function useChatNavigation() {
  const navigateToChat = useCallback(async (chatJid: string): Promise<void> => {
    navigate({ jid: chatJid })
  }, [])

  const navigateToMessage = useCallback(
    async (chatJid: string, messageId: string): Promise<void> => {
      navigate({ jid: chatJid, targetMessageId: messageId })
    },
    []
  )

  return { navigateToChat, navigateToMessage }
}
