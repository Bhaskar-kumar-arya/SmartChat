import React from 'react'
import { Emoji, EmojiStyle } from 'emoji-picker-react'
import emojiRegex from 'emoji-regex'
import { emojiToUnified } from '../../utils/emojiUtils'

interface EmojiTextProps {
  text?: string
  size?: number
  className?: string
  style?: React.CSSProperties
}

const EMOJI_REGEX = emojiRegex()

export const EmojiText: React.FC<EmojiTextProps> = ({ text, size = 16, className, style }) => {
  if (!text) return null

  // Reset lastIndex because we use a global regex instance
  EMOJI_REGEX.lastIndex = 0
  const parts: React.ReactNode[] = []
  let lastIndex = 0
  let match

  while ((match = EMOJI_REGEX.exec(text)) !== null) {
    // Add text before the emoji
    if (match.index > lastIndex) {
      parts.push(text.substring(lastIndex, match.index))
    }

    // Add the emoji component
    const emojiStr = match[0]
    const unified = emojiToUnified(emojiStr)
    parts.push(
      <span key={`${match.index}-${unified}`} className="emoji-inline-wrapper" style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', margin: '0 1px', verticalAlign: 'middle', lineHeight: 1 }}>
        <Emoji unified={unified} size={size} emojiStyle={EmojiStyle.APPLE} />
      </span>
    )

    lastIndex = EMOJI_REGEX.lastIndex
  }

  // Add remaining text
  if (lastIndex < text.length) {
    parts.push(text.substring(lastIndex))
  }

  return (
    <span className={className} style={style}>
      {parts}
    </span>
  )
}
