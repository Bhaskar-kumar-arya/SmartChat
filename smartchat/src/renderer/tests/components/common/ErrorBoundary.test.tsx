import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import { ErrorBoundary } from '@renderer/components/common/ErrorBoundary'

function Boom(): null {
  throw new Error('kaboom')
}

describe('ErrorBoundary (F12-01)', () => {
  beforeEach(() => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
  })
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('renders the full-screen fallback with a Reload action when a child throws', () => {
    render(
      <ErrorBoundary>
        <Boom />
      </ErrorBoundary>
    )
    expect(screen.getByRole('alert')).toBeInTheDocument()
    expect(screen.getByText('Something went wrong')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Reload' })).toBeInTheDocument()
  })

  it('renders a compact placeholder and keeps sibling subtrees alive', () => {
    render(
      <div>
        <ErrorBoundary compact label="Widget">
          <Boom />
        </ErrorBoundary>
        <span>still here</span>
      </div>
    )
    expect(screen.getByText('Widget failed to load.')).toBeInTheDocument()
    expect(screen.getByText('still here')).toBeInTheDocument()
  })

  it('passes children through untouched when nothing throws', () => {
    render(
      <ErrorBoundary>
        <span>healthy</span>
      </ErrorBoundary>
    )
    expect(screen.getByText('healthy')).toBeInTheDocument()
  })
})
