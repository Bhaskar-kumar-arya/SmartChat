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
    // Fetch immediately on mount
    api.extensionGetLog(extensionId).then(setLog).catch(() => setLog(''))

    const intervalId = setInterval(async () => {
      try {
        const text = await api.extensionGetLog(extensionId)
        setLog(text)
      } catch {
        // silently ignore polling errors
      }
    }, 2000)

    return () => clearInterval(intervalId)
  }, [extensionId, api])

  return log
}
