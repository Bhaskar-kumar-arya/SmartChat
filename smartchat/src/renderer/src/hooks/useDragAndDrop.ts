import { useState, useCallback, useRef, useEffect } from 'react'
import { useAPI } from '../context/APIContext'

interface UseDragAndDropOptions {
  onFilesDropped: (paths: string[]) => void
  disabled?: boolean
}

export const useDragAndDrop = ({ onFilesDropped, disabled = false }: UseDragAndDropOptions) => {
  const api = useAPI()
  const [isDraggingOver, setIsDraggingOver] = useState(false)
  const dragCounter = useRef(0)

  const onDragEnter = useCallback(
    (e: React.DragEvent) => {
      if (disabled) return
      e.preventDefault()
      e.stopPropagation()
      dragCounter.current++
      if (e.dataTransfer.items && e.dataTransfer.items.length > 0) {
        setIsDraggingOver(true)
      }
    },
    [disabled]
  )

  const onDragOver = useCallback(
    (e: React.DragEvent) => {
      if (disabled) return
      e.preventDefault()
      e.stopPropagation()
    },
    [disabled]
  )

  const onDragLeave = useCallback(
    (e: React.DragEvent) => {
      if (disabled) return
      e.preventDefault()
      e.stopPropagation()
      dragCounter.current = Math.max(0, dragCounter.current - 1)
      if (dragCounter.current === 0) {
        setIsDraggingOver(false)
      }
    },
    [disabled]
  )

  const onDrop = useCallback(
    (e: React.DragEvent) => {
      if (disabled) return
      e.preventDefault()
      e.stopPropagation()
      setIsDraggingOver(false)
      dragCounter.current = 0

      const files = e.dataTransfer.files
      if (files && files.length > 0) {
        const filePaths: string[] = []
        for (let i = 0; i < files.length; i++) {
          const file = files.item(i)
          if (!file) continue
          try {
            const path = api.getPathForFile(file)
            if (path) {
              filePaths.push(path)
            }
          } catch (err) {
            console.error('[DragDrop] Error calling getPathForFile:', err)
          }
        }
        if (filePaths.length > 0) {
          onFilesDropped(filePaths)
        }
      }
    },
    [disabled, onFilesDropped, api]
  )

  // Safety net: a drag can end without a balancing `dragleave` on the tracked
  // element (drag leaves the window, cancelled with Esc, dropped elsewhere),
  // which would otherwise leave the full-screen overlay stuck (F6-06).
  useEffect(() => {
    const reset = () => {
      dragCounter.current = 0
      setIsDraggingOver(false)
    }
    const onWindowDragLeave = (e: DragEvent) => {
      if (!e.relatedTarget && !((e as unknown as { fromElement?: unknown }).fromElement)) {
        reset()
      }
    }
    window.addEventListener('dragend', reset)
    window.addEventListener('drop', reset)
    window.addEventListener('dragleave', onWindowDragLeave)
    return () => {
      window.removeEventListener('dragend', reset)
      window.removeEventListener('drop', reset)
      window.removeEventListener('dragleave', onWindowDragLeave)
    }
  }, [])

  return {
    isDraggingOver,
    dragHandlers: {
      onDragEnter,
      onDragOver,
      onDragLeave,
      onDrop,
    },
  }
}
