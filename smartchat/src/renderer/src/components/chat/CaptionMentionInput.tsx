import { useRef, type JSX } from 'react'
import { useMentions } from '../../hooks/useMentions'
import MentionMenu from './MentionMenu'

interface CaptionMentionInputProps {
  activeJid: string
  value: string
  placeholder: string
  disabled: boolean
  onChange: (text: string) => void
  onMentionAdd: (jid: string) => void
}

/** Caption text input with the group @-mention menu (mirrors the composer's behaviour). */
export default function CaptionMentionInput({
  activeJid,
  value,
  placeholder,
  disabled,
  onChange,
  onMentionAdd
}: CaptionMentionInputProps): JSX.Element {
  const inputRef = useRef<HTMLInputElement>(null)
  const { participants, menuVisible, query, handleInputChange, addMention, setShowMenu } =
    useMentions(activeJid)

  const handleSelect = (participant: { jid: string; name: string; isAdmin: boolean; isMe: boolean }): void => {
    const input = inputRef.current
    const cursor = input?.selectionStart ?? value.length
    const lastAtPos = value.slice(0, cursor).lastIndexOf('@')
    if (lastAtPos === -1) return

    const number = participant.jid.split('@')[0]
    onChange(value.slice(0, lastAtPos) + `@${number} ` + value.slice(cursor))
    onMentionAdd(participant.jid)
    addMention(participant)

    setTimeout(() => {
      const pos = lastAtPos + number.length + 2
      input?.focus()
      input?.setSelectionRange(pos, pos)
    }, 0)
  }

  return (
    <div style={{ position: 'relative', flex: 1, display: 'flex' }}>
      {menuVisible && (
        <MentionMenu
          participants={participants}
          query={query}
          onSelect={handleSelect}
          onClose={() => setShowMenu(false)}
        />
      )}
      <input
        ref={inputRef}
        type="text"
        className="mfp-caption-input"
        placeholder={placeholder}
        value={value}
        onChange={(e) => {
          onChange(e.target.value)
          handleInputChange(e.target.value, e.target.selectionStart ?? e.target.value.length)
        }}
        disabled={disabled}
        autoFocus
      />
    </div>
  )
}
