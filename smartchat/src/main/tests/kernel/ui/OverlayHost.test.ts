import { describe, it, expect, vi, beforeEach } from 'vitest'
import { OverlayHost } from '../../../kernel/ui/OverlayHost'

describe('OverlayHost', () => {
  let mockMainWindow: any
  let overlayHost: OverlayHost

  beforeEach(() => {
    mockMainWindow = {
      isDestroyed: vi.fn().mockReturnValue(false),
      webContents: {
        send: vi.fn()
      }
    }
    overlayHost = new OverlayHost(() => mockMainWindow)
  })

  it('sends kernel:ui:modal:show IPC message on showModal', async () => {
    const req = { type: 'confirm' as const, modalId: 'm-123', payload: { title: 'Test' } }
    const promise = overlayHost.showModal(req)

    expect(mockMainWindow.webContents.send).toHaveBeenCalledWith('kernel:ui:modal:show', req)

    overlayHost.resolveModal('m-123', true)
    const result = await promise
    expect(result).toBe(true)
  })

  it('resolves modal with form data when resolveModal is called', async () => {
    const req = { type: 'form' as const, modalId: 'm-456', payload: { title: 'Form' } }
    const promise = overlayHost.showModal(req)

    const formData = { field1: 'value1' }
    overlayHost.resolveModal('m-456', formData)

    const result = await promise
    expect(result).toEqual(formData)
  })

  it('ignores resolveModal calls for non-existent modal IDs', () => {
    expect(() => overlayHost.resolveModal('non-existent', true)).not.toThrow()
  })
})
