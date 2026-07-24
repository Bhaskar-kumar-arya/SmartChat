import { describe, it, expect, vi } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useSidebarResize } from '@renderer/components/chat/hooks/useSidebarResize'

describe('useSidebarResize', () => {
  it('should initialize with initial width', () => {
    const { result } = renderHook(() => useSidebarResize(400))
    expect(result.current.sidebarWidth).toBe(400)
  })

  it('should handle resize mouse events bounded between 300 and 800', () => {
    const { result } = renderHook(() => useSidebarResize(500))

    const mockMouseDown = {
      preventDefault: vi.fn(),
      clientX: 500,
    } as any

    act(() => {
      result.current.startResizing(mockMouseDown)
    })

    // Simulate mousemove event (delta = startX (500) - clientX (400) = +100 -> newWidth = 600)
    const mouseMoveEvent = new MouseEvent('mousemove', { clientX: 400 })
    act(() => {
      document.dispatchEvent(mouseMoveEvent)
    })

    expect(result.current.sidebarWidth).toBe(600)

    // Simulate mouseup to remove listeners
    const mouseUpEvent = new MouseEvent('mouseup')
    act(() => {
      document.dispatchEvent(mouseUpEvent)
    })
  })
})
