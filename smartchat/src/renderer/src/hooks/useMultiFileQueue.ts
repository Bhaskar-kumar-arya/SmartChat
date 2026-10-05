import { useState, useCallback } from 'react'

export interface StagedFile {
  path: string
  name: string
  ext: string
  caption: string
  /** JIDs picked from the @-menu for this file's caption (only set once a mention is added). */
  mentions?: string[]
}

/** Mentions to send with a file: those whose `@<number>` token is still in its caption. */
export const mentionsInCaption = (file: StagedFile): string[] =>
  (file.mentions ?? []).filter((jid) => file.caption.includes(`@${jid.split('@')[0]}`))

export const MAX_STAGED_FILES = 30

export const useMultiFileQueue = (maxFiles: number = MAX_STAGED_FILES) => {
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
          existingPaths.add(p)
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

  const addMention = useCallback((index: number, jid: string) => {
    setStagedFiles((prev) =>
      prev.map((f, i) =>
        i === index ? { ...f, mentions: Array.from(new Set([...(f.mentions ?? []), jid])) } : f
      )
    )
  }, [])

  const clearQueue = useCallback(() => {
    setStagedFiles([])
    setSelectedIndex(0)
  }, [])

  return {
    maxFiles,
    stagedFiles,
    selectedIndex,
    setSelectedIndex,
    addFiles,
    removeFile,
    updateCaption,
    addMention,
    clearQueue,
  }
}
