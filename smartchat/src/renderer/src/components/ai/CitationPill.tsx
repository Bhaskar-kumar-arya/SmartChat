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
    resolve(index).then(setEntity)
  }, [index, resolve])

  const isLoading = loadingIndices.has(index)
  const icon = entity ? CITATION_ICONS[entity.type] : '…'
  const label = anchorText?.trim() || icon

  return (
    <button
      className={`citation-pill citation-pill--${entity?.type ?? 'loading'}`}
      onClick={() => handleCitationClick(index)}
      disabled={isLoading || !entity}
      title={entity ? `Go to ${entity.type}: ${JSON.stringify(entity)}` : 'Loading citation…'}
      aria-label={`Citation ${index}: ${label}`}
    >
      {isLoading ? <span className="citation-pill__spinner" /> : label}
    </button>
  )
}
