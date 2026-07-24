import { describe, it, expect, vi } from 'vitest'
import { renderWithProviders, screen, userEvent } from '../../testUtils'
import AIMessageBubble from '@renderer/components/ai/AIMessageBubble'
import { AIChatMessage } from '@renderer/types/aiTypes'

describe('AIMessageBubble', () => {
  const defaultMessage: AIChatMessage = {
    id: 'msg-1',
    role: 'ai',
    content: 'Hello! I am your AI assistant.'
  }

  it('returns null when message is hidden', () => {
    const { container } = renderWithProviders(
      <AIMessageBubble
        message={{ ...defaultMessage, isHidden: true }}
        availableTools={[]}
        isExecuting={false}
        onApprove={vi.fn()}
        onDecline={vi.fn()}
        onRetry={vi.fn()}
        chatList={[]}
      />
    )

    expect(container.firstChild).toBeNull()
  })

  it('renders simple text response correctly', () => {
    renderWithProviders(
      <AIMessageBubble
        message={defaultMessage}
        availableTools={[]}
        isExecuting={false}
        onApprove={vi.fn()}
        onDecline={vi.fn()}
        onRetry={vi.fn()}
        chatList={[]}
      />
    )

    expect(screen.getByText('Hello! I am your AI assistant.')).toBeInTheDocument()
  })

  it('expands thought block when thinking toggle is clicked', async () => {
    const user = userEvent.setup()
    const msgWithThought: AIChatMessage = {
      id: 'msg-thought',
      role: 'ai',
      content: '<thought>Internal reasoning steps here</thought>Here is your answer.'
    }

    renderWithProviders(
      <AIMessageBubble
        message={msgWithThought}
        availableTools={[]}
        isExecuting={false}
        onApprove={vi.fn()}
        onDecline={vi.fn()}
        onRetry={vi.fn()}
        chatList={[]}
      />
    )

    expect(screen.getByText('Here is your answer.')).toBeInTheDocument()
    expect(screen.queryByText('Internal reasoning steps here')).not.toBeInTheDocument()

    const toggleBtn = screen.getByRole('button', { name: /thinking/i })
    await user.click(toggleBtn)

    expect(screen.getByText('Internal reasoning steps here')).toBeInTheDocument()
  })

  it('renders tool call card when message contains tool_call tag', () => {
    const msgWithTool: AIChatMessage = {
      id: 'msg-tool',
      role: 'ai',
      content: '<tool_call>{"tool": "get_weather", "arguments": {"city": "Paris"}}</tool_call>'
    }

    renderWithProviders(
      <AIMessageBubble
        message={msgWithTool}
        availableTools={[{ name: 'get_weather', requiresPermission: true } as any]}
        isExecuting={false}
        onApprove={vi.fn()}
        onDecline={vi.fn()}
        onRetry={vi.fn()}
        chatList={[]}
      />
    )

    expect(screen.getByText(/⚡ Tool Request: get_weather/i)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /approve/i })).toBeInTheDocument()
  })

  it('renders parse error block when tool_call JSON is malformed', () => {
    const msgWithBadTool: AIChatMessage = {
      id: 'msg-bad-tool',
      role: 'ai',
      content: '<tool_call>{invalid json}</tool_call>'
    }

    renderWithProviders(
      <AIMessageBubble
        message={msgWithBadTool}
        availableTools={[]}
        isExecuting={false}
        onApprove={vi.fn()}
        onDecline={vi.fn()}
        onRetry={vi.fn()}
        chatList={[]}
      />
    )

    expect(screen.getByText('Failed to parse tool call')).toBeInTheDocument()
  })

  it('renders user message actions (Edit, Re-run)', async () => {
    const user = userEvent.setup()
    const onReRun = vi.fn()

    const userMessage: AIChatMessage = {
      id: 'msg-user',
      role: 'user',
      content: 'What is the capital of France?'
    }

    renderWithProviders(
      <AIMessageBubble
        message={userMessage}
        availableTools={[]}
        isExecuting={false}
        onApprove={vi.fn()}
        onDecline={vi.fn()}
        onRetry={vi.fn()}
        onReRun={onReRun}
        chatList={[]}
      />
    )

    const reRunBtn = screen.getByTitle('Re-run')
    await user.click(reRunBtn)
    expect(onReRun).toHaveBeenCalledWith('msg-user')

    const editBtn = screen.getByTitle('Edit')
    await user.click(editBtn)
    expect(screen.getByText('ESC to cancel')).toBeInTheDocument()
  })

  it('renders retry button when hasError is true', async () => {
    const user = userEvent.setup()
    const onRetry = vi.fn()

    renderWithProviders(
      <AIMessageBubble
        message={{ ...defaultMessage, hasError: true }}
        availableTools={[]}
        isExecuting={false}
        onApprove={vi.fn()}
        onDecline={vi.fn()}
        onRetry={onRetry}
        chatList={[]}
      />
    )

    const retryBtn = screen.getByRole('button', { name: /retry/i })
    await user.click(retryBtn)
    expect(onRetry).toHaveBeenCalledOnce()
  })
})
