import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { TextMessageProps } from '../../types'

/**
 * Renders text with highlighted mentions.
 * Satisfies SRP (only handles text rendering).
 */
export const TextMessage = ({ text, mentions = {} }: TextMessageProps) => {
  if (!text) return null

  // Normalize mentions to Record<string, string>
  const normalizedMentions: Record<string, string> = {};
  if (mentions) {
    if (Array.isArray(mentions)) {
      mentions.forEach(jid => {
        const name = jid.split('@')[0];
        normalizedMentions[jid] = name;
        normalizedMentions[name] = name; // support matching just number
      });
    } else {
      Object.assign(normalizedMentions, mentions);
    }
  }

  // Convert WhatsApp-style formatting (*bold*, ~strike~) to standard Markdown (**bold**, ~~strike~~)
  // while preserving code blocks and inline code.
  const convertWhatsAppToMarkdown = (rawText: string) => {
    if (!rawText) return ''
    // Split by code blocks (```...```) and inline code (`...`) to avoid formatting inside them
    const parts = rawText.split(/(```[\s\S]+?```|`[^`\n]+?`)/g)
    
    return parts.map(part => {
      // If it is a code block or inline code, preserve it
      if (part.startsWith('```') || part.startsWith('`')) {
        return part
      }
      // Otherwise, replace single asterisks with double asterisks, and single tildes with double tildes
      return part
        .replace(/(?<!\*)\*(?!\*)(?!\s)([^*\n]+?)(?<!\s)(?<!\*)\*(?!\*)/g, '**$1**')
        .replace(/(?<!~)~(?!~)(?!\s)([^~\n]+?)(?<!\s)(?<!~)~(?!~)/g, '~~$1~~')
    }).join('')
  }

  // Preprocess mentions into markdown links so ReactMarkdown handles them correctly.
  const preprocessMentionsToMarkdown = (rawText: string) => {
    if (!rawText) return ''
    const parts = rawText.split(/(@\[[\w.@-]+\]|@[\w.@-]+)/g)
    return parts.map(part => {
      if (part.startsWith('@')) {
        let rawContent = part.substring(1)
        if (rawContent.startsWith('[') && rawContent.endsWith(']')) {
          rawContent = rawContent.substring(1, rawContent.length - 1)
        }
        
        let name = normalizedMentions[rawContent]
        
        if (!name && /^\d+$/.test(rawContent)) {
          name = normalizedMentions[`${rawContent}@s.whatsapp.net`] || normalizedMentions[`${rawContent}@lid`]
        }

        if (!name) {
          const foundKey = Object.keys(normalizedMentions).find(k => k.startsWith(rawContent))
          if (foundKey) name = normalizedMentions[foundKey]
        }

        if (name) {
          return `[@${name}](mention:${encodeURIComponent(rawContent)})`
        }
        return `[${part}](mention:${encodeURIComponent(rawContent)})`
      }
      return part
    }).join('')
  }

  const formattedText = convertWhatsAppToMarkdown(text)
  const markdownText = preprocessMentionsToMarkdown(formattedText)


  return (
    <div className="markdown-body">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          a: ({ href, children }: any) => {
            if (href && href.startsWith('mention:')) {
              return (
                <span className="message-mention" style={{ color: 'var(--primary, #00a884)', fontWeight: 600 }}>
                  {children}
                </span>
              )
            }
            return (
              <a href={href} target="_blank" rel="noopener noreferrer">
                {children}
              </a>
            )
          }
        }}
      >
        {markdownText}
      </ReactMarkdown>
    </div>
  )
}


