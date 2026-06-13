import { useState, useCallback, useRef } from 'react'

interface UseDragAndDropOptions {
  onFilesDropped: (paths: string[]) => void
  disabled?: boolean
}

export const useDragAndDrop = ({ onFilesDropped, disabled = false }: UseDragAndDropOptions) => {
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
      dragCounter.current--
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
            const path = window.api.getPathForFile(file)
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
    [disabled, onFilesDropped]
  )

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
