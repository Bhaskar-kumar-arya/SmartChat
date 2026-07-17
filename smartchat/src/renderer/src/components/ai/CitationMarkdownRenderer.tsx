import React, { useMemo } from 'react'
import { CitationPill } from './CitationPill'

/** Returns a ReactMarkdown `components` object with a cite:-aware anchor renderer. */
export function useCitationMarkdownComponents(sessionId: string | null) {
  return useMemo(() => ({
    a: ({ href, children }: React.AnchorHTMLAttributes<HTMLAnchorElement> & { children?: React.ReactNode }) => {
      if (href?.startsWith('cite:')) {
        // Extract the first contiguous sequence of digits from the href
        const match = href.match(/\d+/);
        const index = match ? parseInt(match[0], 10) : NaN;
        
        if (!isNaN(index)) {
          // Flatten children to text if it's an array/object
          let anchorText = '';
          if (typeof children === 'string') {
            anchorText = children;
          } else if (Array.isArray(children)) {
            anchorText = children.map(c => typeof c === 'string' ? c : '').join('');
          }
          return <CitationPill index={index} anchorText={anchorText} sessionId={sessionId} />
        } else {
          // If the AI generated an invalid cite: link, render a disabled pill rather than a broken link
          return <button className="citation-pill citation-pill--loading" disabled title="Invalid citation">…</button>
        }
      }
      // Passthrough: render non-citation links normally
      return <a href={href} target="_blank" rel="noreferrer">{children}</a>
    }
  }), [sessionId])
}
