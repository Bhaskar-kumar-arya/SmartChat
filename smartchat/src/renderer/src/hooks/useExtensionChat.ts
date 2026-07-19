import { useState, useEffect, useCallback } from 'react'
import { useAPI } from '../context/APIContext'
import { ExtensionChatMessage } from '../types/extension.types'

/**
 * DIP layer for extension chat IPC + live push subscription.
 * Owns: history fetch, onExtensionChatPush listener, send.
 * Components receive { messages, send } only — no direct api calls.
 */
export function useExtensionChat(extensionId: string) {
  const api = useAPI()
  const [messages, setMessages] = useState<ExtensionChatMessage[]>([])

  useEffect(() => {
    // Load history on mount / extensionId change
    api.extensionChatHistory(extensionId).then(setMessages).catch(console.error)

    // Subscribe to live push messages
    const unsubscribe = api.onExtensionChatPush((payload: { extensionId: string, message: ExtensionChatMessage }) => {
      if (payload.extensionId === extensionId) {
        setMessages((prev) => [...prev, payload.message])
      }
    })

    return () => unsubscribe()
  }, [extensionId, api])

  const send = useCallback(
    (text: string) => {
      api.extensionChatSend(extensionId, text)
    },
    [extensionId, api]
  )

  return { messages, send }
}
