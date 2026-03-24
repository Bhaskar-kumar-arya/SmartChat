import { useEffect, useState } from 'react'
import { api } from '../services/api.service'
import { SearchResults } from '../types'

const DEBOUNCE_MS = 300

/**
 * Hook to manage global search state.
 * Single Responsibility: only manages search query lifecycle and results.
 */
export const useSearch = (query: string) => {
  const [results, setResults] = useState<SearchResults>({ chats: [], messages: [] })
  const [isSearching, setIsSearching] = useState(false)

  useEffect(() => {
    if (!query.trim()) {
      setResults({ chats: [], messages: [] })
      setIsSearching(false)
      return
    }

    setIsSearching(true)

    const timer = setTimeout(async () => {
      try {
        const data = await api.searchAll(query)
        setResults(data)
      } catch (err) {
        console.error('[useSearch] search failed:', err)
        setResults({ chats: [], messages: [] })
      } finally {
        setIsSearching(false)
      }
    }, DEBOUNCE_MS)

    return () => clearTimeout(timer)
  }, [query])

  return { results, isSearching }
}
