import { describe, it, expect, vi } from 'vitest'
import { renderWithProviders, screen, fireEvent, act } from '../testUtils'
import { ModalPortal } from '../../src/components/overlays/ModalPortal'
import { createMockApiService } from '../mocks/mockApiService'
import { OverlayFormSchema } from '@smartchat/sdk'

describe('ModalPortal', () => {
  it('renders nothing when no modals are requested', () => {
    renderWithProviders(<ModalPortal />)
    expect(screen.queryByTestId('tier1-modal-overlay')).toBeNull()
  })

  it('renders FormModal when a form request is received', () => {
    let onModalShowCallback: ((req: any) => void) | null = null

    const mockApi = createMockApiService({
      onModalShow: vi.fn().mockImplementation((cb) => {
        onModalShowCallback = cb
        return () => {}
      }),
      resolveModal: vi.fn()
    })

    renderWithProviders(<ModalPortal />, { apiService: mockApi })

    const schema: OverlayFormSchema = {
      title: 'User Feedback',
      fields: [
        { id: 'username', type: 'text', label: 'User Name', defaultValue: 'Alice' },
        { id: 'role', type: 'select', label: 'Role', options: [{ label: 'Admin', value: 'admin' }, { label: 'User', value: 'user' }] },
        { id: 'subscribe', type: 'checkbox', label: 'Subscribe', defaultValue: true }
      ]
    }

    act(() => {
      onModalShowCallback!({
        type: 'form',
        modalId: 'modal-form-1',
        payload: schema
      })
    })

    expect(screen.getByTestId('form-modal')).toBeInTheDocument()
    expect(screen.getByText('User Feedback')).toBeInTheDocument()

    // Fill form and submit
    act(() => {
      fireEvent.click(screen.getByTestId('form-modal-submit'))
    })

    expect(mockApi.resolveModal).toHaveBeenCalledWith('modal-form-1', {
      username: 'Alice',
      role: 'admin',
      subscribe: true
    })
  })

  it('renders ConfirmModal and resolves true on confirm', () => {
    let onModalShowCallback: ((req: any) => void) | null = null

    const mockApi = createMockApiService({
      onModalShow: vi.fn().mockImplementation((cb) => {
        onModalShowCallback = cb
        return () => {}
      }),
      resolveModal: vi.fn()
    })

    renderWithProviders(<ModalPortal />, { apiService: mockApi })

    act(() => {
      onModalShowCallback!({
        type: 'confirm',
        modalId: 'modal-confirm-1',
        payload: { title: 'Delete Item?', body: 'This cannot be undone.' }
      })
    })

    expect(screen.getByTestId('confirm-modal')).toBeInTheDocument()
    expect(screen.getByText('Delete Item?')).toBeInTheDocument()

    act(() => {
      fireEvent.click(screen.getByTestId('confirm-modal-confirm'))
    })
    expect(mockApi.resolveModal).toHaveBeenCalledWith('modal-confirm-1', true)
  })

  it('renders AlertModal and resolves undefined on click OK', () => {
    let onModalShowCallback: ((req: any) => void) | null = null

    const mockApi = createMockApiService({
      onModalShow: vi.fn().mockImplementation((cb) => {
        onModalShowCallback = cb
        return () => {}
      }),
      resolveModal: vi.fn()
    })

    renderWithProviders(<ModalPortal />, { apiService: mockApi })

    act(() => {
      onModalShowCallback!({
        type: 'alert',
        modalId: 'modal-alert-1',
        payload: { title: 'Notice', body: 'Operation complete successfully.' }
      })
    })

    expect(screen.getByTestId('alert-modal')).toBeInTheDocument()
    expect(screen.getByText('Notice')).toBeInTheDocument()

    act(() => {
      fireEvent.click(screen.getByTestId('alert-modal-ok'))
    })
    expect(mockApi.resolveModal).toHaveBeenCalledWith('modal-alert-1', undefined)
  })

  it('does not stack a duplicate modal when the same request id is re-sent (F10-12)', () => {
    let onModalShowCallback: ((req: any) => void) | null = null
    const mockApi = createMockApiService({
      onModalShow: vi.fn().mockImplementation((cb) => {
        onModalShowCallback = cb
        return () => {}
      }),
      resolveModal: vi.fn()
    })

    renderWithProviders(<ModalPortal />, { apiService: mockApi })

    const req = { type: 'confirm', modalId: 'dup-1', payload: { title: 'Only Once' } }
    act(() => {
      onModalShowCallback!(req)
      onModalShowCallback!(req)
    })

    expect(screen.getAllByTestId('confirm-modal')).toHaveLength(1)
  })

  it('dismisses active modal on Escape key press', () => {
    let onModalShowCallback: ((req: any) => void) | null = null

    const mockApi = createMockApiService({
      onModalShow: vi.fn().mockImplementation((cb) => {
        onModalShowCallback = cb
        return () => {}
      }),
      resolveModal: vi.fn()
    })

    renderWithProviders(<ModalPortal />, { apiService: mockApi })

    act(() => {
      onModalShowCallback!({
        type: 'confirm',
        modalId: 'modal-confirm-2',
        payload: { title: 'Cancel Action' }
      })
    })

    act(() => {
      fireEvent.keyDown(window, { key: 'Escape' })
    })
    expect(mockApi.resolveModal).toHaveBeenCalledWith('modal-confirm-2', false)
  })
})
