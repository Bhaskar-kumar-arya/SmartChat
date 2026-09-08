import { useState, useCallback, useRef } from 'react'

// No hard-coded fallback key: a committed key leaks in every build and abusing
// it rate-limits the owner. When unconfigured, the GIF/sticker tabs show a
// "not configured" state instead of hitting GIPHY with a dead key (F6-09).
const getGiphyApiKey = (): string =>
  (import.meta.env.VITE_GIPHY_API_KEY as string | undefined) || ''

export function useGiphy() {
  const [gifs, setGifs] = useState<any[]>([])
  const [giphyStickers, setGiphyStickers] = useState<any[]>([])
  const [loading, setLoading] = useState(false)
  const [giphyError, setGiphyError] = useState<string | null>(null)
  // Request sequencing — ignore a resolution from a superseded query (F6-14).
  const requestIdRef = useRef(0)

  const fetchGiphy = useCallback(async (query: string, type: 'gifs' | 'stickers') => {
    const apiKey = getGiphyApiKey()
    if (!apiKey) {
      setGiphyError('GIF search is not configured.')
      setGifs([])
      setGiphyStickers([])
      return
    }
    const requestId = ++requestIdRef.current
    setLoading(true)
    setGiphyError(null)
    try {
      const endpoint = query.trim() ? 'search' : 'trending'
      const searchParams = new URLSearchParams({
        api_key: apiKey,
        limit: '24',
        rating: 'g',
        ...(query.trim() && { q: query.trim() })
      })
      const url = `https://api.giphy.com/v1/${type}/${endpoint}?${searchParams.toString()}`
      const res = await fetch(url)
      if (requestId !== requestIdRef.current) return
      if (res.ok) {
        const json = await res.json()
        if (requestId !== requestIdRef.current) return
        if (type === 'gifs') {
          setGifs(json.data || [])
        } else {
          setGiphyStickers(json.data || [])
        }
      } else {
        if (res.status === 401) {
          setGiphyError('GIPHY API Key is invalid or unauthorized.')
        } else {
          setGiphyError(`GIPHY error: ${res.status} ${res.statusText || ''}`)
        }
      }
    } catch (err) {
      if (requestId !== requestIdRef.current) return
      console.error(`Failed to fetch Giphy ${type}:`, err)
      setGiphyError('Network error or connection blocked by CSP.')
    } finally {
      if (requestId === requestIdRef.current) setLoading(false)
    }
  }, [])

  const clearGifs = useCallback(() => {
    setGifs([])
    setGiphyStickers([])
    setGiphyError(null)
  }, [])

  return {
    gifs,
    giphyStickers,
    loading,
    giphyError,
    fetchGiphy,
    clearGifs
  }
}
