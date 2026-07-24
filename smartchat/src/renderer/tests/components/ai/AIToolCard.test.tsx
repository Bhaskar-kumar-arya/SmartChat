import { describe, it, expect, vi } from 'vitest'
import { renderWithProviders, screen, userEvent } from '../../testUtils'
import AIToolCard from '@renderer/components/ai/AIToolCard'

describe('AIToolCard', () => {
  it('renders tool request name and arguments for permission-required tools', () => {
    const onApprove = vi.fn()
    const onDecline = vi.fn()

    renderWithProviders(
      <AIToolCard
        toolData={{ tool: 'search_messages', arguments: { query: 'hello' } }}
        isExecuting={false}
        requiresPermission={true}
        onApprove={onApprove}
        onDecline={onDecline}
      />
    )

    expect(screen.getByText(/⚡ Tool Request: search_messages/i)).toBeInTheDocument()
    expect(screen.getByText(/"query": "hello"/i)).toBeInTheDocument()

    expect(screen.getByRole('button', { name: /approve/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /decline/i })).toBeInTheDocument()
  })

  it('triggers onApprove and onDecline callbacks when clicked', async () => {
    const user = userEvent.setup()
    const onApprove = vi.fn()
    const onDecline = vi.fn()

    renderWithProviders(
      <AIToolCard
        toolData={{ tool: 'export_data', arguments: {} }}
        isExecuting={false}
        requiresPermission={true}
        onApprove={onApprove}
        onDecline={onDecline}
      />
    )

    await user.click(screen.getByRole('button', { name: /approve/i }))
    expect(onApprove).toHaveBeenCalledOnce()

    await user.click(screen.getByRole('button', { name: /decline/i }))
    expect(onDecline).toHaveBeenCalledOnce()
  })

  it('renders auto-executing state when tool does not require permission', () => {
    renderWithProviders(
      <AIToolCard
        toolData={{ tool: 'get_time', arguments: {} }}
        isExecuting={true}
        requiresPermission={false}
        onApprove={vi.fn()}
        onDecline={vi.fn()}
      />
    )

    expect(screen.getByText(/⚡ Auto-executing.../i)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /approve/i })).not.toBeInTheDocument()
  })

  it('renders tool result when toolResult is present', () => {
    renderWithProviders(
      <AIToolCard
        toolData={{ tool: 'get_time', arguments: {} }}
        toolResult="Current time: 10:00 AM"
        isExecuting={false}
        requiresPermission={true}
        onApprove={vi.fn()}
        onDecline={vi.fn()}
      />
    )

    expect(screen.getByText(/Result:/i)).toBeInTheDocument()
    expect(screen.getByText(/Current time: 10:00 AM/i)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /approve/i })).not.toBeInTheDocument()
  })
})
