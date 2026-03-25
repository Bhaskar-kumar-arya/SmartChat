import { useEffect, useState } from 'react'
import { api } from '../services/api.service'
import { SearchFilters, SearchMode, SearchResults } from '../types'

const DEBOUNCE_MS = 300
const DEEP_DEBOUNCE_MS = 600

/**
 * Hook to manage global search state.
 * Supports keyword (normal) and semantic (deep) search with filters.
 */
export const useSearch = (query: string, mode: SearchMode = 'normal', filters?: SearchFilters) => {
  const [results, setResults] = useState<SearchResults>({ chats: [], messages: [] })
  const [isSearching, setIsSearching] = useState(false)

  useEffect(() => {
    if (!query.trim()) {
      setResults({ chats: [], messages: [] })
      setIsSearching(false)
      return
    }

    let ignored = false
    setIsSearching(true)

    const debounce = mode === 'deep' ? DEEP_DEBOUNCE_MS : DEBOUNCE_MS

    const timer = setTimeout(async () => {
      try {
        const data = await api.searchAll(query, mode, filters)
        if (!ignored) setResults(data)
      } catch (err) {
        if (!ignored) {
          console.error('[useSearch] search failed:', err)
          setResults({ chats: [], messages: [] })
        }
      } finally {
        if (!ignored) setIsSearching(false)
      }
    }, debounce)

    return () => {
      ignored = true
      clearTimeout(timer)
    }
  }, [query, mode, filters])

  return { results, isSearching }
}
