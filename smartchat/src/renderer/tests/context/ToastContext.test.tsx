import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, act } from '@testing-library/react'
import { ToastProvider, useToast } from '@renderer/context/ToastContext'

function Harness() {
  const { showToast, showError } = useToast()
  return (
    <div>
      <button onClick={() => showToast('saved', 'success', 1000)}>toast</button>
      <button onClick={() => showError(new Error('boom'))}>error</button>
    </div>
  )
}

describe('ToastContext (F12-06)', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  it('shows a toast and auto-dismisses it after the duration', () => {
    render(
      <ToastProvider>
        <Harness />
      </ToastProvider>
    )

    act(() => {
      screen.getByText('toast').click()
    })
    expect(screen.getByText('saved')).toBeInTheDocument()

    act(() => {
      vi.advanceTimersByTime(1000)
    })
    expect(screen.queryByText('saved')).not.toBeInTheDocument()
  })

  it('showError surfaces an Error message as an alert', () => {
    render(
      <ToastProvider>
        <Harness />
      </ToastProvider>
    )

    act(() => {
      screen.getByText('error').click()
    })
    const alert = screen.getByRole('alert')
    expect(alert).toHaveTextContent('boom')
  })
})
