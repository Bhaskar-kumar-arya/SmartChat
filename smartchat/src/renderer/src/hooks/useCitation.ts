import { useCallback, useState } from 'react'
import { useAPI } from '../context/APIContext'
import { CitationEntity } from '../types/ai/citation.types'
import { useCitationActions } from './useCitationActions'

interface UseCitationOptions {
  sessionId: string | null
}

// Module-level cache: { [sessionId]: Map<index, entity> }
const globalCitationCache: Record<string, Map<number, CitationEntity>> = {}

export function useCitation({ sessionId }: UseCitationOptions) {
  const api = useAPI()
  const { dispatch } = useCitationActions()

  const [loadingIndices, setLoadingIndices] = useState<Set<number>>(new Set())

  /**
   * Resolve a single citation index to its entity.
   * Results are memoized in globalCitationCache to prevent repeated IPC calls.
   */
  const resolve = useCallback(
    async (index: number): Promise<CitationEntity | null> => {
      if (!sessionId) return null

      const sessionCache = globalCitationCache[sessionId] ?? new Map()
      if (sessionCache.has(index)) {
        return sessionCache.get(index) ?? null
      }

      setLoadingIndices((prev) => new Set(prev).add(index))
      try {
        const entity = await api.resolveCitation(sessionId, index)
        if (entity) {
          sessionCache.set(index, entity)
          globalCitationCache[sessionId] = sessionCache
        }
        return entity
      } finally {
        setLoadingIndices((prev) => {
          const next = new Set(prev)
          next.delete(index)
          return next
        })
      }
    },
    [api, sessionId]
  )

  /**
   * Click handler for a citation pill.
   * Resolves the entity then delegates to CitationActionRegistry.
   */
  const handleCitationClick = useCallback(
    async (index: number): Promise<void> => {
      const entity = await resolve(index)
      if (entity) {
        dispatch(entity)
      }
    },
    [resolve, dispatch]
  )

  return { resolve, handleCitationClick, loadingIndices }
}
