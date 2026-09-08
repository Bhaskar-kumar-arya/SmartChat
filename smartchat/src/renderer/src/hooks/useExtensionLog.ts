import { useState, useEffect } from 'react'
import { useAPI } from '../context/APIContext'

/**
 * DIP layer for extension log polling.
 * Owns the 2-second interval — component body has zero side-effects.
 */
export function useExtensionLog(extensionId: string | null): string {
  const api = useAPI()
  const [log, setLog] = useState('')

  useEffect(() => {
    if (!extensionId) {
      setLog('')
      return
    }

    let alive = true
    let fetching = false

    const poll = async () => {
      // Skip this tick if the previous fetch is still in flight — prevents
      // overlapping requests landing out of order on a slow backend.
      if (fetching) return
      fetching = true
      try {
        const text = await api.extensionGetLog(extensionId)
        if (alive) setLog(text)
      } catch {
        // silently ignore polling errors
      } finally {
        fetching = false
      }
    }

    let intervalId: ReturnType<typeof setInterval> | null = null
    const startPolling = () => {
      if (intervalId == null && document.visibilityState === 'visible') {
        intervalId = setInterval(poll, 2000)
      }
    }
    const stopPolling = () => {
      if (intervalId != null) {
        clearInterval(intervalId)
        intervalId = null
      }
    }
    // Don't poll a backgrounded window (F12-08).
    const onVisibility = () => {
      if (document.visibilityState === 'visible') {
        void poll()
        startPolling()
      } else {
        stopPolling()
      }
    }

    void poll()
    startPolling()
    document.addEventListener('visibilitychange', onVisibility)

    return () => {
      alive = false
      stopPolling()
      document.removeEventListener('visibilitychange', onVisibility)
    }
  }, [extensionId, api])

  return log
}
