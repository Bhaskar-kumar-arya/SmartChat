import { useState, useCallback } from 'react'

export function useSidebarResize(initialWidth: number = 500) {
  const [sidebarWidth, setSidebarWidth] = useState<number>(initialWidth)

  const startResizing = useCallback((mouseDownEvent: React.MouseEvent) => {
    mouseDownEvent.preventDefault()
    const startX = mouseDownEvent.clientX
    const startWidth = sidebarWidth

    const onMouseMove = (mouseMoveEvent: MouseEvent) => {
      const delta = startX - mouseMoveEvent.clientX
      const newWidth = Math.min(Math.max(startWidth + delta, 300), 800)
      setSidebarWidth(newWidth)
    }

    const onMouseUp = () => {
      document.removeEventListener('mousemove', onMouseMove)
      document.removeEventListener('mouseup', onMouseUp)
    }

    document.addEventListener('mousemove', onMouseMove)
    document.addEventListener('mouseup', onMouseUp)
  }, [sidebarWidth])

  return { sidebarWidth, startResizing }
}
