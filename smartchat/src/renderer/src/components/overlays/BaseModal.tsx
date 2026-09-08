import React, { useEffect, useRef } from 'react'
import ReactDOM from 'react-dom'

/**
 * Shared modal primitive (F10-05 / F5-14 / F8-09).
 *
 * Provides the behaviour every dialog in the app needs and most were missing:
 *  - portals to `document.body` so it always sits above the app tree
 *  - `Escape` closes (only the visually top-most modal reacts — F10-11)
 *  - focus trap (Tab / Shift+Tab cycle inside the dialog)
 *  - focus save on open + restore to the opener on close
 *  - `role="dialog"` + `aria-modal="true"`
 *  - body scroll lock + `inert` on `#root` while any modal is open (F10-07)
 */

const modalStack: symbol[] = []
let savedBodyOverflow = ''

function applyAppLock(): void {
  if (modalStack.length !== 1) return
  savedBodyOverflow = document.body.style.overflow
  document.body.style.overflow = 'hidden'
  const root = document.getElementById('root')
  root?.setAttribute('inert', '')
  root?.setAttribute('aria-hidden', 'true')
}

function releaseAppLock(): void {
  if (modalStack.length !== 0) return
  document.body.style.overflow = savedBodyOverflow
  const root = document.getElementById('root')
  root?.removeAttribute('inert')
  root?.removeAttribute('aria-hidden')
}

const FOCUSABLE_SELECTOR = [
  'a[href]',
  'area[href]',
  'input:not([disabled])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  'button:not([disabled])',
  'iframe',
  'object',
  'embed',
  '[tabindex]:not([tabindex="-1"])',
  '[contenteditable="true"]'
].join(',')

export interface BaseModalProps {
  onClose: () => void
  children: React.ReactNode
  closeOnEscape?: boolean
  closeOnBackdrop?: boolean
  label?: string
  labelledBy?: string
  overlayClassName?: string
  overlayTestId?: string
  containerClassName?: string
  containerStyle?: React.CSSProperties
  containerTestId?: string
}

export function BaseModal({
  onClose,
  children,
  closeOnEscape = true,
  closeOnBackdrop = true,
  label,
  labelledBy,
  overlayClassName = 'modal-overlay',
  overlayTestId,
  containerClassName,
  containerStyle,
  containerTestId
}: BaseModalProps) {
  const containerRef = useRef<HTMLDivElement | null>(null)
  const idRef = useRef<symbol>(Symbol('modal'))
  const onCloseRef = useRef(onClose)
  onCloseRef.current = onClose

  const isTop = (): boolean => modalStack[modalStack.length - 1] === idRef.current

  useEffect(() => {
    const id = idRef.current
    const previouslyFocused = document.activeElement as HTMLElement | null
    modalStack.push(id)
    applyAppLock()

    // Move focus into the dialog.
    const container = containerRef.current
    const focusables = container?.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)
    if (focusables && focusables.length > 0) {
      focusables[0].focus()
    } else {
      container?.focus()
    }

    const handleKeyDown = (e: KeyboardEvent) => {
      if (!isTop()) return
      if (e.key === 'Escape' && closeOnEscape) {
        e.stopPropagation()
        onCloseRef.current()
      }
    }
    window.addEventListener('keydown', handleKeyDown, true)

    return () => {
      window.removeEventListener('keydown', handleKeyDown, true)
      const idx = modalStack.indexOf(id)
      if (idx !== -1) modalStack.splice(idx, 1)
      releaseAppLock()
      previouslyFocused?.focus?.()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const handleTrapKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (e.key !== 'Tab') return
    const container = containerRef.current
    if (!container) return
    const focusables = Array.from(
      container.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)
    ).filter((el) => !el.hasAttribute('disabled') && el.getAttribute('aria-hidden') !== 'true')
    if (focusables.length === 0) {
      e.preventDefault()
      return
    }
    const first = focusables[0]
    const last = focusables[focusables.length - 1]
    const active = document.activeElement as HTMLElement
    if (e.shiftKey && (active === first || !container.contains(active))) {
      e.preventDefault()
      last.focus()
    } else if (!e.shiftKey && active === last) {
      e.preventDefault()
      first.focus()
    }
  }

  const handleBackdropClick = (e: React.MouseEvent<HTMLDivElement>) => {
    if (e.target === e.currentTarget && closeOnBackdrop) onClose()
  }

  return ReactDOM.createPortal(
    <div
      className={overlayClassName}
      onClick={handleBackdropClick}
      data-testid={overlayTestId}
    >
      <div
        ref={containerRef}
        role="dialog"
        aria-modal="true"
        aria-label={label}
        aria-labelledby={labelledBy}
        tabIndex={-1}
        className={containerClassName}
        style={containerClassName ? containerStyle : { display: 'contents', ...containerStyle }}
        data-testid={containerTestId}
        onClick={(e) => e.stopPropagation()}
        onKeyDown={handleTrapKeyDown}
      >
        {children}
      </div>
    </div>,
    document.body
  )
}
