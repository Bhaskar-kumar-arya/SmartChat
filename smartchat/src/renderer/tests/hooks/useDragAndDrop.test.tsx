import React from 'react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useDragAndDrop } from '@renderer/hooks/useDragAndDrop'
import { APIProvider } from '@renderer/context/APIContext'
import { createMockApiService } from '../mocks/mockApiService'

describe('useDragAndDrop', () => {
  let mockApi: ReturnType<typeof createMockApiService>

  const createWrapper = (api = mockApi) => {
    return ({ children }: { children: React.ReactNode }) => (
      <APIProvider service={api}>{children}</APIProvider>
    )
  }

  beforeEach(() => {
    mockApi = createMockApiService()
  })

  it('should handle drag enter, drag over, and drag leave counter', () => {
    const onFilesDropped = vi.fn()
    const { result } = renderHook(() => useDragAndDrop({ onFilesDropped }), {
      wrapper: createWrapper(),
    })

    const mockEvent = {
      preventDefault: vi.fn(),
      stopPropagation: vi.fn(),
      dataTransfer: { items: [{ kind: 'file' }] },
    } as any

    act(() => {
      result.current.dragHandlers.onDragEnter(mockEvent)
    })
    expect(result.current.isDraggingOver).toBe(true)

    act(() => {
      result.current.dragHandlers.onDragLeave(mockEvent)
    })
    expect(result.current.isDraggingOver).toBe(false)
  })

  it('should process dropped files and call onFilesDropped with paths', () => {
    const onFilesDropped = vi.fn()
    mockApi.getPathForFile = vi.fn().mockImplementation((file: File) => `/path/${file.name}`)

    const { result } = renderHook(() => useDragAndDrop({ onFilesDropped }), {
      wrapper: createWrapper(),
    })

    const mockFile1 = new File(['content'], 'file1.txt')
    const mockFile2 = new File(['content'], 'file2.png')

    const mockDropEvent = {
      preventDefault: vi.fn(),
      stopPropagation: vi.fn(),
      dataTransfer: {
        files: {
          length: 2,
          item: (i: number) => (i === 0 ? mockFile1 : mockFile2),
        },
      },
    } as any

    act(() => {
      result.current.dragHandlers.onDrop(mockDropEvent)
    })

    expect(result.current.isDraggingOver).toBe(false)
    expect(onFilesDropped).toHaveBeenCalledWith(['/path/file1.txt', '/path/file2.png'])
  })

  it('should ignore events when disabled', () => {
    const onFilesDropped = vi.fn()
    const { result } = renderHook(() => useDragAndDrop({ onFilesDropped, disabled: true }), {
      wrapper: createWrapper(),
    })

    const mockEvent = {
      preventDefault: vi.fn(),
      stopPropagation: vi.fn(),
      dataTransfer: { items: [{ kind: 'file' }] },
    } as any

    act(() => {
      result.current.dragHandlers.onDragEnter(mockEvent)
    })

    expect(result.current.isDraggingOver).toBe(false)
  })
})
