import { useState, useEffect, useCallback, useRef } from 'react'
import { useAPI } from '../context/APIContext'
import { ExtensionChatMessage } from '../types/extension.types'

/**
 * DIP layer for extension chat IPC + live push subscription.
 * Owns: history fetch, onExtensionChatPush listener, send.
 * Components receive { messages, send } only — no direct api calls.
 */
function mergeById(
  base: ExtensionChatMessage[],
  incoming: ExtensionChatMessage[]
): ExtensionChatMessage[] {
  const seen = new Set(base.map((m) => m.id))
  const merged = [...base]
  for (const m of incoming) {
    if (!seen.has(m.id)) {
      seen.add(m.id)
      merged.push(m)
    }
  }
  return merged
}

export function useExtensionChat(extensionId: string) {
  const api = useAPI()
  const [messages, setMessages] = useState<ExtensionChatMessage[]>([])
  const activeIdRef = useRef(extensionId)

  useEffect(() => {
    activeIdRef.current = extensionId
    let alive = true
    // Pushes that arrive before the history fetch resolves are buffered here so
    // the full-replace of the history load cannot drop them.
    let historyLoaded = false
    const pending: ExtensionChatMessage[] = []

    setMessages([])

    api
      .extensionChatHistory(extensionId)
      .then((msgs) => {
        if (!alive || activeIdRef.current !== extensionId) return
        historyLoaded = true
        setMessages(mergeById(msgs, pending))
        pending.length = 0
      })
      .catch(console.error)

    const unsubscribe = api.onExtensionChatPush(
      (payload: { extensionId: string; message: ExtensionChatMessage }) => {
        if (!alive || payload.extensionId !== extensionId) return
        if (!historyLoaded) {
          pending.push(payload.message)
          return
        }
        setMessages((prev) => mergeById(prev, [payload.message]))
      }
    )

    return () => {
      alive = false
      unsubscribe()
    }
  }, [extensionId, api])

  const send = useCallback(
    (text: string) => {
      Promise.resolve(api.extensionChatSend(extensionId, text)).catch(console.error)
    },
    [extensionId, api]
  )

  return { messages, send }
}
