import { useState, useCallback } from 'react'

export interface StagedFile {
  path: string
  name: string
  ext: string
  caption: string
}

export const useMultiFileQueue = (maxFiles: number = 30) => {
  const [stagedFiles, setStagedFiles] = useState<StagedFile[]>([])
  const [selectedIndex, setSelectedIndex] = useState<number>(0)

  const addFiles = useCallback(
    (paths: string[]) => {
      let didAddFirst = false
      setStagedFiles((prev) => {
        const existingPaths = new Set(prev.map((f) => f.path))
        const newFiles: StagedFile[] = []

        for (const p of paths) {
          if (existingPaths.has(p)) continue
          if (prev.length + newFiles.length >= maxFiles) break

          const name = p.split(/[\\/]/).pop() || 'File'
          const ext = name.split('.').pop()?.toLowerCase() || ''
          newFiles.push({ path: p, name, ext, caption: '' })
        }

        if (newFiles.length === 0) return prev
        if (prev.length === 0) {
          didAddFirst = true
        }
        return [...prev, ...newFiles]
      })

      if (didAddFirst) {
        setSelectedIndex(0)
      }
    },
    [maxFiles]
  )

  const removeFile = useCallback((index: number) => {
    setStagedFiles((prev) => {
      const next = prev.filter((_, i) => i !== index)
      return next
    })

    setSelectedIndex((prevIndex) => {
      if (prevIndex >= index) {
        return Math.max(0, prevIndex - 1)
      }
      return prevIndex
    })
  }, [])

  const updateCaption = useCallback((index: number, caption: string) => {
    setStagedFiles((prev) => {
      return prev.map((f, i) => (i === index ? { ...f, caption } : f))
    })
  }, [])

  const clearQueue = useCallback(() => {
    setStagedFiles([])
    setSelectedIndex(0)
  }, [])

  return {
    stagedFiles,
    selectedIndex,
    setSelectedIndex,
    addFiles,
    removeFile,
    updateCaption,
    clearQueue,
  }
}
