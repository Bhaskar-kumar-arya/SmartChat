import { useCallback } from 'react'
import { CitationEntity } from '../types/ai/citation.types'
import { useAPI } from '../context/APIContext'
import { useChatNavigation } from './useChatNavigation'

export function useCitationActions() {
  const api = useAPI()
  const { navigateToMessage, navigateToChat } = useChatNavigation()

  const dispatch = useCallback(
    async (entity: CitationEntity): Promise<void> => {
      switch (entity.type) {
        case 'message':
          // Open the chat and scroll to the specific message
          await navigateToMessage(entity.chatJid, entity.messageId)
          break

        case 'chat':
          // Switch active chat
          await navigateToChat(entity.chatJid)
          break

        case 'file':
          // Delegate to OS file opener
          await api.openFile(entity.filePath)
          break

        // Future extension: add new cases here without touching anything above.
      }
    },
    [api, navigateToMessage, navigateToChat]
  )

  return { dispatch }
}
