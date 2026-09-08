import React, { createContext, useContext, useCallback, useRef, useState } from 'react'

export type ToastKind = 'info' | 'success' | 'error'

export interface Toast {
  id: number
  kind: ToastKind
  message: string
}

export interface ToastContextValue {
  /** Show a toast. Returns its id (for manual `dismiss`). */
  showToast: (message: string, kind?: ToastKind, durationMs?: number) => number
  /** Convenience: show an error toast. Accepts a string or an Error. */
  showError: (error: unknown, fallback?: string) => number
  dismiss: (id: number) => void
}

const noop = (): number => 0
const ToastContext = createContext<ToastContextValue>({
  showToast: noop,
  showError: noop,
  dismiss: () => {}
})

const DEFAULT_DURATION: Record<ToastKind, number> = {
  info: 4000,
  success: 3000,
  error: 7000
}

function messageFrom(error: unknown, fallback: string): string {
  if (typeof error === 'string' && error.trim()) return error
  if (error instanceof Error && error.message) return error.message
  return fallback
}

/**
 * Minimal app-wide error/notification surface (F12-06). Previously every failed
 * user-initiated action was swallowed with `console.error` and the user got zero
 * feedback. `useToast()` gives any component a way to surface a failure.
 */
export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([])
  const nextId = useRef(1)
  const timers = useRef<Map<number, ReturnType<typeof setTimeout>>>(new Map())

  const dismiss = useCallback((id: number) => {
    setToasts((prev) => prev.filter((t) => t.id !== id))
    const timer = timers.current.get(id)
    if (timer) {
      clearTimeout(timer)
      timers.current.delete(id)
    }
  }, [])

  const showToast = useCallback(
    (message: string, kind: ToastKind = 'info', durationMs?: number): number => {
      const id = nextId.current++
      setToasts((prev) => [...prev, { id, kind, message }])
      const ms = durationMs ?? DEFAULT_DURATION[kind]
      if (ms > 0) {
        const timer = setTimeout(() => dismiss(id), ms)
        timers.current.set(id, timer)
      }
      return id
    },
    [dismiss]
  )

  const showError = useCallback(
    (error: unknown, fallback = 'Something went wrong. Please try again.'): number =>
      showToast(messageFrom(error, fallback), 'error'),
    [showToast]
  )

  return (
    <ToastContext.Provider value={{ showToast, showError, dismiss }}>
      {children}
      {toasts.length > 0 && (
      <div
        className="toast-container"
        aria-live="polite"
        style={{
          position: 'fixed',
          bottom: 16,
          left: '50%',
          transform: 'translateX(-50%)',
          display: 'flex',
          flexDirection: 'column',
          gap: 8,
          zIndex: 99999,
          pointerEvents: 'none'
        }}
      >
        {toasts.map((t) => (
          <div
            key={t.id}
            role={t.kind === 'error' ? 'alert' : 'status'}
            onClick={() => dismiss(t.id)}
            style={{
              pointerEvents: 'auto',
              cursor: 'pointer',
              maxWidth: 420,
              padding: '10px 16px',
              borderRadius: 8,
              fontSize: 13,
              lineHeight: 1.4,
              color: '#fff',
              boxShadow: '0 4px 16px rgba(0,0,0,0.35)',
              background:
                t.kind === 'error' ? '#c0392b' : t.kind === 'success' ? '#1e824c' : '#2c3e50'
            }}
          >
            {t.message}
          </div>
        ))}
      </div>
      )}
    </ToastContext.Provider>
  )
}

export const useToast = (): ToastContextValue => useContext(ToastContext)

export { ToastContext }
