import React, { useEffect, useState } from 'react'
import { CitationEntity, CITATION_ICONS } from '../../types/ai/citation.types'
import { useCitation } from '../../hooks/useCitation'

interface CitationPillProps {
  index: number
  anchorText?: string          // text inside [text](cite:N) — may be empty
  sessionId: string | null
}

export const CitationPill: React.FC<CitationPillProps> = ({
  index,
  anchorText,
  sessionId
}) => {
  const { resolve, handleCitationClick, loadingIndices } = useCitation({ sessionId })
  const [entity, setEntity] = useState<CitationEntity | null>(null)

  useEffect(() => {
    let alive = true
    resolve(index).then((e) => {
      if (alive) setEntity(e)
    })
    return () => {
      alive = false
    }
  }, [index, resolve])

  const isLoading = loadingIndices.has(index)
  const icon = entity ? CITATION_ICONS[entity.type] : '…'
  const label = anchorText?.trim() || icon

  // F8-10: human-readable tooltip instead of dumping the raw entity JSON
  // (which leaked absolute file paths / internal JIDs).
  let title = 'Loading citation…'
  if (entity) {
    if (entity.type === 'file') {
      const name = entity.filePath.split(/[\\/]/).pop() || entity.filePath
      title = `Go to file: ${name}`
    } else if (entity.type === 'message') {
      title = 'Go to message'
    } else {
      title = 'Go to chat'
    }
  }

  return (
    <button
      className={`citation-pill citation-pill--${entity?.type ?? 'loading'}`}
      onClick={() => handleCitationClick(index)}
      disabled={isLoading || !entity}
      title={title}
      aria-label={`Citation ${index}: ${label}`}
    >
      {isLoading ? <span className="citation-pill__spinner" /> : label}
    </button>
  )
}
