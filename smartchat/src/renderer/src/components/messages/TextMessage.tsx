import { Fragment } from 'react'

interface TextMessageProps {
  text: string
  mentions?: Record<string, string>
}

/**
 * Renders text with highlighted mentions.
 * Satisfies SRP (only handles text rendering).
 */
export const TextMessage = ({ text, mentions = {} }: TextMessageProps) => {
  if (!text) return null

  const parts = text.split(/(@\[[\w.@-]+\]|@[\w.@-]+)/g)
  
  return (
    <Fragment>
      {parts.map((part, i) => {
        if (part.startsWith('@')) {
          let rawContent = part.substring(1)
          if (rawContent.startsWith('[') && rawContent.endsWith(']')) {
            rawContent = rawContent.substring(1, rawContent.length - 1)
          }
          
          let name = mentions[rawContent]
          
          if (!name && /^\d+$/.test(rawContent)) {
            name = mentions[`${rawContent}@s.whatsapp.net`] || mentions[`${rawContent}@lid`]
          }

          if (!name) {
            const foundKey = Object.keys(mentions).find(k => k.startsWith(rawContent))
            if (foundKey) name = mentions[foundKey]
          }

          if (name) {
            return (
              <span key={i} className="message-mention" style={{ color: 'var(--primary, #00a884)', fontWeight: 600 }}>
                @{name}
              </span>
            )
          }
          return (
            <span key={i} className="message-mention" style={{ color: 'var(--primary, #00a884)', fontWeight: 600 }}>
              {part}
            </span>
          )
        }
        return part
      })}
    </Fragment>
  )
}
