import { useState, useCallback } from 'react'

const GIPHY_API_KEY = (import.meta.env.VITE_GIPHY_API_KEY as string) || '5Gf9Jd9uS7N9xI5U8H7vFjXy4H9mN8Z1'

export function useGiphy() {
  const [gifs, setGifs] = useState<any[]>([])
  const [giphyStickers, setGiphyStickers] = useState<any[]>([])
  const [loading, setLoading] = useState(false)
  const [giphyError, setGiphyError] = useState<string | null>(null)

  const fetchGiphy = useCallback(async (query: string, type: 'gifs' | 'stickers') => {
    setLoading(true)
    setGiphyError(null)
    try {
      const endpoint = query.trim() ? 'search' : 'trending'
      const searchParams = new URLSearchParams({
        api_key: GIPHY_API_KEY,
        limit: '24',
        rating: 'g',
        ...(query.trim() && { q: query.trim() })
      })
      const url = `https://api.giphy.com/v1/${type}/${endpoint}?${searchParams.toString()}`
      const res = await fetch(url)
      if (res.ok) {
        const json = await res.json()
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
      console.error(`Failed to fetch Giphy ${type}:`, err)
      setGiphyError('Network error or connection blocked by CSP.')
    } finally {
      setLoading(false)
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
