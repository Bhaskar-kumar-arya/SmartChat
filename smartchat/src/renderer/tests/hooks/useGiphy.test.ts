import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useGiphy } from '@renderer/hooks/useGiphy'

describe('useGiphy', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn())
    vi.stubEnv('VITE_GIPHY_API_KEY', 'test-key')
  })

  afterEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllEnvs()
  })

  it('does not call GIPHY and surfaces a not-configured error when the key is missing', async () => {
    vi.stubEnv('VITE_GIPHY_API_KEY', '')

    const { result } = renderHook(() => useGiphy())

    await act(async () => {
      await result.current.fetchGiphy('cats', 'gifs')
    })

    expect(fetch).not.toHaveBeenCalled()
    expect(result.current.giphyError).toBe('GIF search is not configured.')
  })

  it('ignores a stale response when a newer query is in flight (F6-14)', async () => {
    let resolveFirst: (v: any) => void = () => {}
    const firstResponse = new Promise(res => { resolveFirst = res })
    ;(fetch as any)
      .mockImplementationOnce(() => firstResponse)
      .mockResolvedValueOnce({ ok: true, json: async () => ({ data: [{ id: 'new' }] }) })

    const { result } = renderHook(() => useGiphy())

    await act(async () => {
      const p1 = result.current.fetchGiphy('old', 'gifs')
      const p2 = result.current.fetchGiphy('new', 'gifs')
      resolveFirst({ ok: true, json: async () => ({ data: [{ id: 'old' }] }) })
      await Promise.all([p1, p2])
    })

    expect(result.current.gifs).toEqual([{ id: 'new' }])
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
