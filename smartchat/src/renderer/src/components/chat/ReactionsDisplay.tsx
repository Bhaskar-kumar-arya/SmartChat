import { ReactionItem } from '../../types'

interface ReactionsDisplayProps {
  reactions?: ReactionItem[]
  onClick: () => void
}

export default function ReactionsDisplay({ reactions, onClick }: ReactionsDisplayProps) {
  if (!reactions || reactions.length === 0) return null
  
  const emojiCounts: Record<string, number> = {}
  for (const r of reactions) {
    emojiCounts[r.text] = (emojiCounts[r.text] || 0) + 1
  }
  const uniqueEmojis = Object.keys(emojiCounts)
  
  return (
    <div className="message-reactions" onClick={onClick} style={{ cursor: 'pointer' }}>
      <div className="reaction-bubbles-group">
        {uniqueEmojis.slice(0, 3).map((emoji) => (
          <span key={emoji} className="reaction-bubble-mini">{emoji}</span>
        ))}
      </div>
      {reactions.length > 0 && <span className="reaction-total-count">{reactions.length}</span>}
    </div>
  )
}
