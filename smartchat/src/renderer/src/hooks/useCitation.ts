import { useCallback, useState } from 'react'
import { useAPI } from '../context/APIContext'
import { CitationEntity } from '../types/ai/citation.types'
import { useCitationActions } from './useCitationActions'

interface UseCitationOptions {
  sessionId: string | null
}

// Module-level cache: { [sessionId]: Map<index, entity | null> }
// F8-04: negative (unresolvable) results are cached as `null` too, so an
// unresolvable citation in a streaming answer doesn't re-hit IPC on every
// markdown re-parse.
const globalCitationCache: Record<string, Map<number, CitationEntity | null>> = {}
// F8-04: dedupe concurrent resolves for the same (sessionId, index).
const inFlightCitations: Map<string, Promise<CitationEntity | null>> = new Map()

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

      const flightKey = `${sessionId}:${index}`
      const existing = inFlightCitations.get(flightKey)
      if (existing) return existing

      setLoadingIndices((prev) => new Set(prev).add(index))
      const promise = (async () => {
        try {
          const entity = await api.resolveCitation(sessionId, index)
          sessionCache.set(index, entity ?? null)
          globalCitationCache[sessionId] = sessionCache
          return entity ?? null
        } finally {
          inFlightCitations.delete(flightKey)
          setLoadingIndices((prev) => {
            const next = new Set(prev)
            next.delete(index)
            return next
          })
        }
      })()
      inFlightCitations.set(flightKey, promise)
      return promise
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
