import { Component, ErrorInfo, ReactNode } from 'react'

interface Props {
  children: ReactNode
  /**
   * Custom fallback UI. When omitted a full-screen "Something went wrong — Reload"
   * screen is rendered (suitable for the root boundary). Pass `compact` for a
   * small inline placeholder instead (suitable for nested/pane boundaries).
   */
  fallback?: ReactNode
  /** Render a small inline placeholder rather than the full-screen screen. */
  compact?: boolean
  /** Label used in the console error line and the compact placeholder. */
  label?: string
  onError?: (error: Error, info: ErrorInfo) => void
}

interface State {
  hasError: boolean
}

/**
 * Generic React error boundary (F12-01).
 *
 * - Root usage (`main.tsx`): no props → full-screen recoverable fallback.
 * - Nested usage (panel stage, AI sidebar, …): `compact` → inline placeholder so
 *   one bad pane degrades gracefully instead of taking the whole window.
 *
 * The leaf-level `MessageErrorBoundary` (F5-06 / F8-07) is kept as a dedicated
 * per-row boundary; this component is the app-level + pane-level safety net.
 */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false }

  static getDerivedStateFromError(): State {
    return { hasError: true }
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    const tag = this.props.label ? `ErrorBoundary:${this.props.label}` : 'ErrorBoundary'
    console.error(`[${tag}] render failed:`, error, info)
    this.props.onError?.(error, info)
  }

  private handleReload = (): void => {
    window.location.reload()
  }

  render(): ReactNode {
    if (!this.state.hasError) return this.props.children
    if (this.props.fallback !== undefined) return this.props.fallback
    if (this.props.compact) {
      return (
        <div className="error-boundary-compact" role="alert">
          {this.props.label ? `${this.props.label} failed to load.` : "This section couldn't be displayed."}
        </div>
      )
    }
    return (
      <div
        className="error-boundary-fullscreen"
        role="alert"
        style={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 12,
          height: '100vh',
          width: '100vw',
          padding: 24,
          textAlign: 'center',
          boxSizing: 'border-box',
          background: 'var(--wa-bg, #111b21)',
          color: 'var(--wa-text, #e9edef)',
          fontFamily: 'system-ui, sans-serif'
        }}
      >
        <h1 style={{ fontSize: 20, margin: 0 }}>Something went wrong</h1>
        <p style={{ margin: 0, opacity: 0.8, maxWidth: 420 }}>
          The app hit an unexpected error. Reloading usually fixes it.
        </p>
        <button
          type="button"
          onClick={this.handleReload}
          style={{
            marginTop: 8,
            padding: '8px 20px',
            borderRadius: 6,
            border: 'none',
            cursor: 'pointer',
            background: 'var(--wa-primary, #00a884)',
            color: '#fff',
            fontSize: 14
          }}
        >
          Reload
        </button>
      </div>
    )
  }
}
