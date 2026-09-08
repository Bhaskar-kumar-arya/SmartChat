import { render, screen, fireEvent } from '@testing-library/react'
import { describe, it, expect, vi } from 'vitest'
import { BaseModal } from '../../../src/components/overlays/BaseModal'

describe('BaseModal (shared modal primitive)', () => {
  it('exposes role="dialog" + aria-modal and closes on Escape', () => {
    const onClose = vi.fn()
    render(
      <BaseModal onClose={onClose} label="Test">
        <button>inside</button>
      </BaseModal>
    )
    const dialog = screen.getByRole('dialog')
    expect(dialog).toHaveAttribute('aria-modal', 'true')

    fireEvent.keyDown(window, { key: 'Escape' })
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('closes on backdrop click but not on content click', () => {
    const onClose = vi.fn()
    render(
      <BaseModal onClose={onClose} overlayTestId="ov" label="Test">
        <button>inside</button>
      </BaseModal>
    )
    fireEvent.click(screen.getByText('inside'))
    expect(onClose).not.toHaveBeenCalled()

    fireEvent.click(screen.getByTestId('ov'))
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('restores focus to the opener element on unmount', () => {
    const opener = document.createElement('button')
    opener.textContent = 'opener'
    document.body.appendChild(opener)
    opener.focus()
    expect(document.activeElement).toBe(opener)

    const { unmount } = render(
      <BaseModal onClose={vi.fn()} label="Test">
        <button>inside</button>
      </BaseModal>
    )
    // focus moved into the dialog
    expect(document.activeElement).toBe(screen.getByText('inside'))

    unmount()
    expect(document.activeElement).toBe(opener)
    opener.remove()
  })

  it('only the visually top-most modal reacts to Escape', () => {
    const onCloseOuter = vi.fn()
    const onCloseInner = vi.fn()
    const { rerender } = render(
      <>
        <BaseModal onClose={onCloseOuter} label="outer">
          <button>outer-btn</button>
        </BaseModal>
        <BaseModal onClose={onCloseInner} label="inner">
          <button>inner-btn</button>
        </BaseModal>
      </>
    )
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(onCloseInner).toHaveBeenCalledTimes(1)
    expect(onCloseOuter).not.toHaveBeenCalled()

    rerender(
      <>
        <BaseModal onClose={onCloseOuter} label="outer">
          <button>outer-btn</button>
        </BaseModal>
      </>
    )
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(onCloseOuter).toHaveBeenCalledTimes(1)
  })

  it('locks body scroll while open and restores it after close', () => {
    expect(document.body.style.overflow).toBe('')
    const { unmount } = render(
      <BaseModal onClose={vi.fn()} label="Test">
        <button>inside</button>
      </BaseModal>
    )
    expect(document.body.style.overflow).toBe('hidden')
    unmount()
    expect(document.body.style.overflow).toBe('')
  })
})
