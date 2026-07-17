import { useCallback } from 'react'

/**
 * Provides imperative navigation methods usable from any component
 * without coupling to ChatLayout's internal state.
 *
 * Mechanism: emits custom DOM events that ChatLayout listens to.
 * This avoids prop-drilling across the AI sidebar boundary.
 */
export function useChatNavigation() {
  const navigateToChat = useCallback(async (chatJid: string): Promise<void> => {
    // We emit a synthetic event that ChatLayout's existing listener handles.
    window.dispatchEvent(
      new CustomEvent('smartchat:open-chat', { detail: { jid: chatJid } })
    )
  }, [])

  const navigateToMessage = useCallback(
    async (chatJid: string, messageId: string): Promise<void> => {
      // Step 1: open the chat (reuse existing event)
      window.dispatchEvent(
        new CustomEvent('smartchat:open-chat', { detail: { jid: chatJid, targetMessageId: messageId } })
      )
    },
    []
  )

  return { navigateToChat, navigateToMessage }
}
