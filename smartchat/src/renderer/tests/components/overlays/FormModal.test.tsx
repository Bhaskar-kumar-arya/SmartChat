import { render, screen, fireEvent } from '@testing-library/react'
import { describe, it, expect, vi } from 'vitest'
import { FormModal } from '../../../src/components/overlays/FormModal'
import { OverlayFormSchema } from '@smartchat/sdk'

describe('FormModal validation (F10-04)', () => {
  it('flags a required checkbox that is left unchecked', () => {
    const onSubmit = vi.fn()
    const schema: OverlayFormSchema = {
      title: 'Consent',
      fields: [{ id: 'agree', type: 'checkbox', label: 'I agree', required: true }]
    }
    render(<FormModal modalId="m1" schema={schema} onSubmit={onSubmit} />)

    fireEvent.click(screen.getByTestId('form-modal-submit'))
    expect(onSubmit).not.toHaveBeenCalled()
    expect(screen.getByText('I agree is required')).toBeDefined()

    fireEvent.click(screen.getByTestId('field-checkbox-agree'))
    fireEvent.click(screen.getByTestId('form-modal-submit'))
    expect(onSubmit).toHaveBeenCalledWith({ agree: true })
  })

  it('still allows an optional unchecked checkbox through', () => {
    const onSubmit = vi.fn()
    const schema: OverlayFormSchema = {
      title: 'Opt',
      fields: [{ id: 'news', type: 'checkbox', label: 'Newsletter' }]
    }
    render(<FormModal modalId="m2" schema={schema} onSubmit={onSubmit} />)
    fireEvent.click(screen.getByTestId('form-modal-submit'))
    expect(onSubmit).toHaveBeenCalledWith({ news: false })
  })
})
