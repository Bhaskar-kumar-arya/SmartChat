import { describe, it, expect, vi, beforeEach } from 'vitest'
import { ipcMain } from 'electron'
import { registerOverlayIpcHandlers } from '../../../kernel/ipc/overlayIpc'
import { IOverlayHost } from '../../../kernel/ui/IOverlayHost'

vi.mock('electron', () => {
  const handlers = new Map<string, Function>()
  const listeners = new Map<string, Function>()

  return {
    ipcMain: {
      handle: vi.fn((channel: string, fn: Function) => {
        handlers.set(channel, fn)
      }),
      on: vi.fn((channel: string, fn: Function) => {
        listeners.set(channel, fn)
      }),
      removeHandler: vi.fn((channel: string) => {
        handlers.delete(channel)
      }),
      removeListener: vi.fn((channel: string) => {
        listeners.delete(channel)
      }),
      _invokeHandle: (channel: string, event: any, opts: any) => {
        const fn = handlers.get(channel)
        if (fn) return fn(event, opts)
      },
      _emitOn: (channel: string, event: any, opts: any) => {
        const fn = listeners.get(channel)
        if (fn) return fn(event, opts)
      }
    }
  }
})

describe('overlayIpc', () => {
  let mockOverlayHost: IOverlayHost

  beforeEach(() => {
    vi.clearAllMocks()
    mockOverlayHost = {
      showModal: vi.fn(),
      resolveModal: vi.fn(),
      showOverlay: vi.fn(),
      sendToOverlay: vi.fn(),
      closeOverlay: vi.fn(),
      onOverlaySubmit: vi.fn(),
      onOverlayEvent: vi.fn(),
      onOverlayDismiss: vi.fn()
    }
  })

  it('registers IPC handlers for modal resolve and overlay submit, event, and dismiss', () => {
    registerOverlayIpcHandlers(mockOverlayHost)

    expect(ipcMain.handle).toHaveBeenCalledWith('kernel:ui:modal:resolve', expect.any(Function))
    expect(ipcMain.on).toHaveBeenCalledWith('kernel:ui:overlay:submit', expect.any(Function))
    expect(ipcMain.on).toHaveBeenCalledWith('kernel:ui:overlay:event', expect.any(Function))
    expect(ipcMain.on).toHaveBeenCalledWith('kernel:ui:overlay:dismiss', expect.any(Function))
  })

  it('delegates kernel:ui:overlay:submit to overlayHost.onOverlaySubmit', () => {
    registerOverlayIpcHandlers(mockOverlayHost)

    const testPayload = { overlayId: 'ov-1', data: { value: 42 } }
    ;(ipcMain as any)._emitOn('kernel:ui:overlay:submit', {}, testPayload)

    expect(mockOverlayHost.onOverlaySubmit).toHaveBeenCalledWith('ov-1', { value: 42 })
  })

  it('delegates kernel:ui:overlay:event to overlayHost.onOverlayEvent', () => {
    registerOverlayIpcHandlers(mockOverlayHost)

    const testPayload = { overlayId: 'ov-1', event: 'customEvent', data: { status: 'ok' } }
    ;(ipcMain as any)._emitOn('kernel:ui:overlay:event', {}, testPayload)

    expect(mockOverlayHost.onOverlayEvent).toHaveBeenCalledWith('ov-1', 'customEvent', { status: 'ok' })
  })

  it('delegates kernel:ui:overlay:dismiss to overlayHost.onOverlayDismiss', () => {
    registerOverlayIpcHandlers(mockOverlayHost)

    const testPayload = { overlayId: 'ov-1' }
    ;(ipcMain as any)._emitOn('kernel:ui:overlay:dismiss', {}, testPayload)

    expect(mockOverlayHost.onOverlayDismiss).toHaveBeenCalledWith('ov-1')
  })

  it('cleans up handlers when unregister disposer is called', () => {
    const dispose = registerOverlayIpcHandlers(mockOverlayHost)
    dispose()

    expect(ipcMain.removeHandler).toHaveBeenCalledWith('kernel:ui:modal:resolve')
    expect(ipcMain.removeListener).toHaveBeenCalledWith('kernel:ui:overlay:submit', expect.any(Function))
    expect(ipcMain.removeListener).toHaveBeenCalledWith('kernel:ui:overlay:event', expect.any(Function))
    expect(ipcMain.removeListener).toHaveBeenCalledWith('kernel:ui:overlay:dismiss', expect.any(Function))
  })
})
