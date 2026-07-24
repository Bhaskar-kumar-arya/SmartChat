import { describe, it, expect } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useMultiFileQueue } from '@renderer/hooks/useMultiFileQueue'

describe('useMultiFileQueue', () => {
  it('should initialize with an empty file queue', () => {
    const { result } = renderHook(() => useMultiFileQueue(5))

    expect(result.current.stagedFiles).toEqual([])
    expect(result.current.selectedIndex).toBe(0)
  })

  it('should add unique files to queue and set selectedIndex to 0 if initial add', () => {
    const { result } = renderHook(() => useMultiFileQueue(5))

    act(() => {
      result.current.addFiles(['/path/to/doc.pdf', '/path/to/image.png'])
    })

    expect(result.current.stagedFiles).toHaveLength(2)
    expect(result.current.stagedFiles[0]).toEqual({
      path: '/path/to/doc.pdf',
      name: 'doc.pdf',
      ext: 'pdf',
      caption: '',
    })
    expect(result.current.selectedIndex).toBe(0)
  })

  it('should prevent adding duplicates and respect maxFiles threshold', () => {
    const { result } = renderHook(() => useMultiFileQueue(2))

    act(() => {
      result.current.addFiles(['/path/to/doc.pdf', '/path/to/doc.pdf', '/path/to/image.png', '/path/to/extra.txt'])
    })

    expect(result.current.stagedFiles).toHaveLength(2)
    expect(result.current.stagedFiles.map(f => f.name)).toEqual(['doc.pdf', 'image.png'])
  })

  it('should remove file by index and adjust selectedIndex correctly', () => {
    const { result } = renderHook(() => useMultiFileQueue(5))

    act(() => {
      result.current.addFiles(['/path/1.txt', '/path/2.txt', '/path/3.txt'])
    })

    act(() => {
      result.current.setSelectedIndex(2)
    })

    act(() => {
      result.current.removeFile(2)
    })

    expect(result.current.stagedFiles).toHaveLength(2)
    expect(result.current.selectedIndex).toBe(1)
  })

  it('should update file caption', () => {
    const { result } = renderHook(() => useMultiFileQueue(5))

    act(() => {
      result.current.addFiles(['/path/1.txt'])
    })

    act(() => {
      result.current.updateCaption(0, 'My document')
    })

    expect(result.current.stagedFiles[0].caption).toBe('My document')
  })

  it('should clear queue', () => {
    const { result } = renderHook(() => useMultiFileQueue(5))

    act(() => {
      result.current.addFiles(['/path/1.txt'])
      result.current.clearQueue()
    })

    expect(result.current.stagedFiles).toEqual([])
    expect(result.current.selectedIndex).toBe(0)
  })
})
