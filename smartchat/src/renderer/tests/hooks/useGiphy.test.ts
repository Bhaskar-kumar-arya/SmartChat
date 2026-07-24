import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useGiphy } from '@renderer/hooks/useGiphy'

describe('useGiphy', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn())
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('should initialize with empty state', () => {
    const { result } = renderHook(() => useGiphy())

    expect(result.current.gifs).toEqual([])
    expect(result.current.giphyStickers).toEqual([])
    expect(result.current.loading).toBe(false)
    expect(result.current.giphyError).toBeNull()
  })

  it('should fetch gifs trending endpoint when query is empty', async () => {
    const mockGifs = [{ id: 'gif1', url: 'https://giphy.com/gif1' }]
    ;(fetch as any).mockResolvedValue({
      ok: true,
      json: async () => ({ data: mockGifs }),
    })

    const { result } = renderHook(() => useGiphy())

    await act(async () => {
      await result.current.fetchGiphy('', 'gifs')
    })

    expect(fetch).toHaveBeenCalledWith(expect.stringContaining('/v1/gifs/trending'))
    expect(result.current.gifs).toEqual(mockGifs)
  })

  it('should fetch stickers search endpoint when query is provided', async () => {
    const mockStickers = [{ id: 'st1', url: 'https://giphy.com/st1' }]
    ;(fetch as any).mockResolvedValue({
      ok: true,
      json: async () => ({ data: mockStickers }),
    })

    const { result } = renderHook(() => useGiphy())

    await act(async () => {
      await result.current.fetchGiphy('cats', 'stickers')
    })

    expect(fetch).toHaveBeenCalledWith(expect.stringContaining('/v1/stickers/search'))
    expect(result.current.giphyStickers).toEqual(mockStickers)
  })

  it('should handle API errors appropriately', async () => {
    ;(fetch as any).mockResolvedValue({
      ok: false,
      status: 401,
    })

    const { result } = renderHook(() => useGiphy())

    await act(async () => {
      await result.current.fetchGiphy('test', 'gifs')
    })

    expect(result.current.giphyError).toBe('GIPHY API Key is invalid or unauthorized.')
  })

  it('should clear state on clearGifs call', async () => {
    const { result } = renderHook(() => useGiphy())

    act(() => {
      result.current.clearGifs()
    })

    expect(result.current.gifs).toEqual([])
    expect(result.current.giphyStickers).toEqual([])
    expect(result.current.giphyError).toBeNull()
  })
})
