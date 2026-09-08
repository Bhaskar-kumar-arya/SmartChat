import { useEffect, useState } from 'react'
import { useAPI } from '../../../context/APIContext'
import { SearchFilters, SearchMode, SearchResults } from '../../../types/chatTypes'

const DEBOUNCE_MS = 300
const DEEP_DEBOUNCE_MS = 600

/**
 * Hook to manage global search state.
 * Supports keyword (normal) and semantic (deep) search with filters.
 */
export const useSearch = (query: string, mode: SearchMode = 'normal', filters?: SearchFilters) => {
  const api = useAPI()
  const [results, setResults] = useState<SearchResults>({ chats: [], messages: [] })
  const [isSearching, setIsSearching] = useState(false)

  // Compare `filters` by value, not reference: a caller passing an inline
  // `filters={{…}}` object would otherwise tear down and recreate the debounce
  // timer on every render, so the search request may never fire (F3-09).
  const filtersKey = JSON.stringify(filters ?? null)

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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query, mode, filtersKey])

  return { results, isSearching }
}
