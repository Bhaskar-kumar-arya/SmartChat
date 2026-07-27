import { useState, useEffect, useCallback } from 'react'
import { useAPI } from '../context/APIContext'
import { LoadedExtension } from '../types/extension.types'

/**
 * DIP layer for Extension Manager IPC.
 * Components never call api.* directly — all IPC is owned here.
 */
export function useExtensionManager() {
  const api = useAPI()
  const [extensions, setExtensions] = useState<LoadedExtension[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const list = await api.extensionList()
      setExtensions(list as LoadedExtension[])
    } catch (err) {
      setError(String(err))
    } finally {
      setLoading(false)
    }
  }, [api])

  useEffect(() => {
    refresh()
  }, [refresh])

  const install = useCallback(
    async (scextPath: string) => {
      await api.extensionInstall(scextPath)
      await refresh()
    },
    [api, refresh]
  )

  const unload = useCallback(
    async (id: string) => {
      await api.extensionUnload(id)
      await refresh()
    },
    [api, refresh]
  )

  const reload = useCallback(
    async (id: string) => {
      await api.extensionReload(id)
      await refresh()
    },
    [api, refresh]
  )

  const uninstall = useCallback(
    async (id: string) => {
      await api.extensionUninstall(id)
      await refresh()
    },
    [api, refresh]
  )

  return { extensions, loading, error, install, unload, reload, uninstall, refresh }
}
