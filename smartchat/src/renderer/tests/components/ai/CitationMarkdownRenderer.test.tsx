import { describe, it, expect, vi } from 'vitest'
import ReactMarkdown, { defaultUrlTransform } from 'react-markdown'
import { renderWithProviders, screen, waitFor } from '../../testUtils'
import { useCitationMarkdownComponents } from '@renderer/components/ai/CitationMarkdownRenderer'
import { createMockApiService } from '../../mocks/mockApiService'

function TestMarkdown({ content, sessionId }: { content: string; sessionId: string | null }) {
  const components = useCitationMarkdownComponents(sessionId)
  return (
    <ReactMarkdown
      components={components}
      urlTransform={(url) => (url.startsWith('cite:') ? url : defaultUrlTransform(url))}
    >
      {content}
    </ReactMarkdown>
  )
}

describe('CitationMarkdownRenderer', () => {
  it('renders citation pills for cite: links', async () => {
    const mockEntity = {
      type: 'message',
      targetJid: 'user@s.whatsapp.net',
      messageId: 'msg-1',
      snippet: 'Test snippet'
    }

    const apiService = createMockApiService({
      resolveCitation: vi.fn().mockResolvedValue(mockEntity)
    })

    renderWithProviders(
      <TestMarkdown content="According to [Ref 1](cite:1) the data is valid." sessionId="sess-1" />,
      { apiService }
    )

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /citation 1: ref 1/i })).toBeInTheDocument()
    })
  })

  it('renders disabled pill for invalid cite: link with no digits', () => {
    renderWithProviders(
      <TestMarkdown content="Broken link [Invalid](cite:abc)" sessionId="sess-1" />
    )

    const button = screen.getByRole('button', { name: '…' })
    expect(button).toBeDisabled()
    expect(button).toHaveTextContent('…')
  })

  it('renders standard anchor for non-cite external links', () => {
    renderWithProviders(
      <TestMarkdown content="Visit [Google](https://google.com)" sessionId="sess-1" />
    )

    const link = screen.getByRole('link', { name: /google/i })
    expect(link).toHaveAttribute('href', 'https://google.com')
    expect(link).toHaveAttribute('target', '_blank')
  })
})
