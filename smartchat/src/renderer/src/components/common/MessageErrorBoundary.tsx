import { Component, ErrorInfo, ReactNode } from 'react'

interface Props {
  children: ReactNode
}

interface State {
  hasError: boolean
}

/**
 * Isolates a single message row so a throw inside one message renderer
 * (media component, markdown/KaTeX edge case, malformed template shape, …)
 * renders a small placeholder instead of unmounting the whole MessageView.
 * App-wide / nested boundary policy is owned by F12-01.
 */
export class MessageErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false }

  static getDerivedStateFromError(): State {
    return { hasError: true }
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error('[MessageErrorBoundary] failed to render message:', error, info)
  }

  render(): ReactNode {
    if (this.state.hasError) {
      return <div className="message-render-error">Couldn&apos;t display this message.</div>
    }
    return this.props.children
  }
}
