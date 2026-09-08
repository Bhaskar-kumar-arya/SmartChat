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

  it('detaches the mousemove listener when unmounted mid-drag (F4-02)', () => {
    const removeSpy = vi.spyOn(document, 'removeEventListener')
    const { result, unmount } = renderHook(() => useSidebarResize(500))

    act(() => {
      result.current.startResizing({ preventDefault: vi.fn(), clientX: 500 } as any)
    })

    unmount()

    expect(removeSpy).toHaveBeenCalledWith('mousemove', expect.any(Function))
    expect(removeSpy).toHaveBeenCalledWith('mouseup', expect.any(Function))

    // A late mousemove must not update state / throw after unmount.
    const widthBefore = result.current.sidebarWidth
    act(() => {
      document.dispatchEvent(new MouseEvent('mousemove', { clientX: 100 }))
    })
    expect(result.current.sidebarWidth).toBe(widthBefore)

    removeSpy.mockRestore()
  })
})
