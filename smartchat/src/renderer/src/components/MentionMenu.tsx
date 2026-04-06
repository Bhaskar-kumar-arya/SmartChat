import { useEffect, useState, useRef } from 'react'

interface Participant {
  jid: string
  name: string
  isAdmin: boolean
  isMe: boolean
}

interface MentionMenuProps {
  participants: Participant[]
  query: string
  onSelect: (participant: Participant) => void
  onClose: () => void
}

export default function MentionMenu({ participants, query, onSelect, onClose }: MentionMenuProps) {
  const [filtered, setFiltered] = useState<Participant[]>([])
  const [selectedIndex, setSelectedIndex] = useState(0)
  const menuRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const q = query.toLowerCase()
    const result = participants.filter(p => 
      !p.isMe && (p.name.toLowerCase().includes(q) || p.jid.split('@')[0].includes(q))
    )
    setFiltered(result.slice(0, 8))
    setSelectedIndex(0)
  }, [participants, query])

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'ArrowDown') {
        e.preventDefault()
        setSelectedIndex(prev => (prev + 1) % filtered.length)
      } else if (e.key === 'ArrowUp') {
        e.preventDefault()
        setSelectedIndex(prev => (prev - 1 + filtered.length) % filtered.length)
      } else if (e.key === 'Enter') {
        if (filtered[selectedIndex]) {
          e.preventDefault()
          onSelect(filtered[selectedIndex])
        }
      } else if (e.key === 'Escape') {
        onClose()
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [filtered, selectedIndex, onSelect, onClose])

  if (filtered.length === 0) return null

  return (
    <div className="mention-menu" ref={menuRef}>
      {filtered.map((p, idx) => (
        <div
          key={p.jid}
          className={`mention-item ${idx === selectedIndex ? 'active' : ''}`}
          onClick={() => onSelect(p)}
        >
          <div className="mention-avatar">
            {p.name.charAt(0).toUpperCase()}
          </div>
          <div className="mention-info">
            <span className="mention-name">{p.name}</span>
            <span className="mention-jid">@{p.jid.split('@')[0]}</span>
          </div>
          {p.isAdmin && <span className="mention-admin-badge">Admin</span>}
        </div>
      ))}
    </div>
  )
}
