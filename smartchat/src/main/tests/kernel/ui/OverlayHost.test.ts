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

  it('handles showOverlay with mode: handle', async () => {
    const res = (await overlayHost.showOverlay('plugin-a', {
      panel: 'test.html',
      mode: 'handle'
    })) as { overlayId: string }

    expect(res).toHaveProperty('overlayId')
    expect(mockMainWindow.webContents.send).toHaveBeenCalledWith(
      'kernel:ui:overlay:show',
      expect.objectContaining({
        overlayId: res.overlayId,
        pluginId: 'plugin-a',
        panel: 'test.html',
        mode: 'handle'
      })
    )
  })

  it('handles showOverlay with mode: promise and resolves on submit', async () => {
    const promise = overlayHost.showOverlay('plugin-a', {
      panel: 'test.html',
      mode: 'promise'
    })

    const reqCall = mockMainWindow.webContents.send.mock.calls.find(
      (call: any[]) => call[0] === 'kernel:ui:overlay:show'
    )
    expect(reqCall).toBeDefined()
    const overlayId = reqCall[1].overlayId

    overlayHost.onOverlaySubmit(overlayId, { result: 'success' })
    const result = await promise
    expect(result).toEqual({ result: 'success' })
  })

  it('rejects showOverlay with OVERLAY_ALREADY_OPEN if plugin already has active overlay', async () => {
    void overlayHost.showOverlay('plugin-a', { panel: 'test.html', mode: 'promise' })

    await expect(
      overlayHost.showOverlay('plugin-a', { panel: 'other.html', mode: 'promise' })
    ).rejects.toMatchObject({
      code: 'OVERLAY_ALREADY_OPEN'
    })
  })

  it('sends IPC on sendToOverlay and closeOverlay', () => {
    overlayHost.sendToOverlay('ov-1', 'search-results', [1, 2])
    expect(mockMainWindow.webContents.send).toHaveBeenCalledWith('kernel:ui:overlay:incoming', {
      overlayId: 'ov-1',
      event: 'search-results',
      data: [1, 2]
    })

    overlayHost.closeOverlay('ov-1')
    expect(mockMainWindow.webContents.send).toHaveBeenCalledWith('kernel:ui:overlay:close', {
      overlayId: 'ov-1'
    })
  })

  it('forwards overlay events to plugin channel in onOverlayEvent', () => {
    const mockChannel = {
      sendToPlugin: vi.fn()
    }
    const host = new OverlayHost(
      () => mockMainWindow,
      (id) => (id === 'plugin-a' ? (mockChannel as any) : undefined)
    )

    void host.showOverlay('plugin-a', { panel: 'test.html', mode: 'handle' })
    const reqCall = mockMainWindow.webContents.send.mock.calls[0]
    const overlayId = reqCall[1].overlayId

    host.onOverlayEvent(overlayId, 'query', { text: 'hello' })

    expect(mockChannel.sendToPlugin).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'kernel:ui:overlay:event',
        payload: { overlayId, event: 'query', data: { text: 'hello' } }
      })
    )
  })
})
