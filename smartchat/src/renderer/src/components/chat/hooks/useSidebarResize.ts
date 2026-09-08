import { useState, useCallback, useEffect, useRef } from 'react'

export function useSidebarResize(initialWidth: number = 500) {
  const [sidebarWidth, setSidebarWidth] = useState<number>(initialWidth)

  // Track the currently-attached drag listeners so an unmount mid-drag can
  // detach them (F4-02). Without this the `mousemove` handler survives the
  // hook and keeps calling `setSidebarWidth` on an unmounted component.
  const listenersRef = useRef<{
    onMouseMove: (e: MouseEvent) => void
    onMouseUp: () => void
  } | null>(null)

  const stopResizing = useCallback(() => {
    if (listenersRef.current) {
      document.removeEventListener('mousemove', listenersRef.current.onMouseMove)
      document.removeEventListener('mouseup', listenersRef.current.onMouseUp)
      listenersRef.current = null
    }
  }, [])

  const startResizing = useCallback(
    (mouseDownEvent: React.MouseEvent) => {
      mouseDownEvent.preventDefault()
      const startX = mouseDownEvent.clientX
      const startWidth = sidebarWidth

      // Detach any listeners from a previous, unfinished drag.
      stopResizing()

      const onMouseMove = (mouseMoveEvent: MouseEvent) => {
        const delta = startX - mouseMoveEvent.clientX
        const newWidth = Math.min(Math.max(startWidth + delta, 300), 800)
        setSidebarWidth(newWidth)
      }

      const onMouseUp = () => {
        stopResizing()
      }

      listenersRef.current = { onMouseMove, onMouseUp }
      document.addEventListener('mousemove', onMouseMove)
      document.addEventListener('mouseup', onMouseUp)
    },
    [sidebarWidth, stopResizing]
  )

  // Detach listeners if the hook unmounts while a drag is in flight.
  useEffect(() => stopResizing, [stopResizing])

  return { sidebarWidth, startResizing }
}
