import { describe, it, expect, vi, beforeEach } from 'vitest'
import { ipcMain } from 'electron'
import { registerPanelIpcHandlers } from '../../../kernel/ipc/panelIpc'
import { IPanelHost } from '../../../kernel/ui/IPanelHost'
import { IKernelAPIRouter } from '../../../kernel/IKernelAPIRouter'
import { IWAEventBus } from '../../../services/whatsapp/IWAEventBus'

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
      _invokeHandle: (channel: string, event: unknown, opts: unknown) => {
        const fn = handlers.get(channel)
        if (fn) return fn(event, opts)
      },
      _emitOn: (channel: string, event: unknown, opts: unknown) => {
        const fn = listeners.get(channel)
        if (fn) return fn(event, opts)
      }
    }
  }
})

describe('panelIpc', () => {
  let mockPanelHost: IPanelHost
  let mockRouter: IKernelAPIRouter
  let mockEventBus: IWAEventBus

  beforeEach(() => {
    vi.clearAllMocks()

    mockPanelHost = {
      registerPanel: vi.fn(),
      findPanel: vi.fn(),
      getPanel: vi.fn(),
      getPluginId: vi.fn((panelId: string) => (panelId === 'panel-1' ? 'com.acme.plugin' : undefined)),
      deregisterPlugin: vi.fn(),
      openPanel: vi.fn().mockResolvedValue({ success: true }),
      closePanel: vi.fn().mockResolvedValue({ success: true })
    }


    mockRouter = {
      registerModule: vi.fn(),
      unregisterModule: vi.fn(),
      getModule: vi.fn(),
      attachChannel: vi.fn(),
      handleRequest: vi.fn(),
      handle: vi.fn().mockResolvedValue({ items: ['chat1', 'chat2'] })
    }

    mockEventBus = {
      on: vi.fn().mockImplementation((_evt: any, _fn: any) => mockEventBus),
      off: vi.fn(),
      emit: vi.fn()
    } as unknown as IWAEventBus

  })

  it('registers IPC handlers for kernel:panel:api, events:subscribe, events:unsubscribe, and panel:closed', () => {
    registerPanelIpcHandlers(mockPanelHost, mockRouter, mockEventBus)

    expect(ipcMain.handle).toHaveBeenCalledWith('kernel:panel:api', expect.any(Function))
    expect(ipcMain.handle).toHaveBeenCalledWith('kernel:panel:events:subscribe', expect.any(Function))
    expect(ipcMain.on).toHaveBeenCalledWith('kernel:panel:events:unsubscribe', expect.any(Function))
    expect(ipcMain.on).toHaveBeenCalledWith('kernel:panel:closed', expect.any(Function))
  })

  it('routes kernel:panel:api request through KernelAPIRouter with resolved pluginId', async () => {
    registerPanelIpcHandlers(mockPanelHost, mockRouter, mockEventBus)

    const req = { panelId: 'panel-1', type: 'kernel:chats:getList', payload: { page: 1, limit: 10 } }
    const result = await (ipcMain as unknown as { _invokeHandle: Function })._invokeHandle('kernel:panel:api', {}, req)

    expect(mockPanelHost.getPluginId).toHaveBeenCalledWith('panel-1')
    expect(mockRouter.handle).toHaveBeenCalledWith('com.acme.plugin', 'kernel:chats:getList', { page: 1, limit: 10 })
    expect(result).toEqual({ ok: true, payload: { items: ['chat1', 'chat2'] } })
  })

  it('returns PANEL_NOT_FOUND error if panelId is invalid', async () => {
    registerPanelIpcHandlers(mockPanelHost, mockRouter, mockEventBus)

    const req = { panelId: 'invalid-panel', type: 'kernel:chats:getList', payload: {} }
    const result = await (ipcMain as unknown as { _invokeHandle: Function })._invokeHandle('kernel:panel:api', {}, req)

    expect(result).toEqual({
      ok: false,
      error: { code: 'PANEL_NOT_FOUND', message: "Panel 'invalid-panel' is not registered" }
    })
    expect(mockRouter.handle).not.toHaveBeenCalled()
  })

  it('returns structured error if KernelAPIRouter throws an exception', async () => {
    vi.mocked(mockRouter.handle).mockRejectedValueOnce(new Error('Permission denied'))

    registerPanelIpcHandlers(mockPanelHost, mockRouter, mockEventBus)

    const req = { panelId: 'panel-1', type: 'kernel:chats:getList', payload: {} }
    const result = await (ipcMain as unknown as { _invokeHandle: Function })._invokeHandle('kernel:panel:api', {}, req)

    expect(result).toEqual({
      ok: false,
      error: { code: 'INTERNAL_ERROR', message: 'Permission denied' }
    })
  })

  it('handles event subscription and forwards events to webview sender', async () => {
    let capturedHandler: Function | undefined
    const mockUnsub = vi.fn()
    vi.mocked(mockEventBus.on).mockImplementation((_evt: any, fn: any): any => {
      capturedHandler = fn
      return mockUnsub
    })


    registerPanelIpcHandlers(mockPanelHost, mockRouter, mockEventBus)

    const mockSender = { isDestroyed: () => false, send: vi.fn() }
    const eventObj = { sender: mockSender }

    const subResult = await (ipcMain as unknown as { _invokeHandle: Function })._invokeHandle(
      'kernel:panel:events:subscribe',
      eventObj,
      { panelId: 'panel-1', eventName: 'message:incoming' }
    )

    expect(subResult).toEqual({ ok: true })
    expect(mockEventBus.on).toHaveBeenCalledWith('message:incoming', expect.any(Function))

    // Trigger event callback
    capturedHandler?.({ id: 'msg-123', text: 'hello' })
    expect(mockSender.send).toHaveBeenCalledWith('smartchat:event', {
      event: 'message:incoming',
      payload: { id: 'msg-123', text: 'hello' }
    })
  })

  it('unsubscribes and cleans up when kernel:panel:closed is emitted', async () => {
    registerPanelIpcHandlers(mockPanelHost, mockRouter, mockEventBus)

    await (ipcMain as unknown as { _invokeHandle: Function })._invokeHandle(
      'kernel:panel:events:subscribe',
      { sender: { isDestroyed: () => false, send: vi.fn() } },
      { panelId: 'panel-1', eventName: 'message:incoming' }
    )

    ;(ipcMain as unknown as { _emitOn: Function })._emitOn('kernel:panel:closed', {}, { panelId: 'panel-1' })

    expect(mockEventBus.off).toHaveBeenCalledWith('message:incoming', expect.any(Function))
  })


  // S9-02
  it('rejects subscribe for an event the panel plugin lacks permission for', async () => {
    const permissions = { hasCapability: vi.fn().mockReturnValue(false) }
    registerPanelIpcHandlers(mockPanelHost, mockRouter, mockEventBus, permissions as any)

    const result = await (ipcMain as unknown as { _invokeHandle: Function })._invokeHandle(
      'kernel:panel:events:subscribe',
      { sender: { isDestroyed: () => false, send: vi.fn() } },
      { panelId: 'panel-1', eventName: 'message:received' }
    )

    expect(result).toMatchObject({ ok: false, error: { code: 'PERMISSION_DENIED' } })
    expect(mockEventBus.on).not.toHaveBeenCalled()
  })

  it('allows subscribe when events:* is granted', async () => {
    const permissions = { hasCapability: vi.fn((_p: string, cap: string) => cap === 'events:*') }
    registerPanelIpcHandlers(mockPanelHost, mockRouter, mockEventBus, permissions as any)

    const result = await (ipcMain as unknown as { _invokeHandle: Function })._invokeHandle(
      'kernel:panel:events:subscribe',
      { sender: { isDestroyed: () => false, send: vi.fn() } },
      { panelId: 'panel-1', eventName: 'message:received' }
    )
    expect(result).toEqual({ ok: true })
  })

  // S9-01
  it('re-attaches live subscriptions to a freshly created bus on onBusConnected', async () => {
    const reg = registerPanelIpcHandlers(mockPanelHost, mockRouter, mockEventBus)
    await (ipcMain as unknown as { _invokeHandle: Function })._invokeHandle(
      'kernel:panel:events:subscribe',
      { sender: { isDestroyed: () => false, send: vi.fn() } },
      { panelId: 'panel-1', eventName: 'message:incoming' }
    )

    let newBusHandler: Function | undefined
    const newBus = {
      on: vi.fn((_e: any, fn: any) => { newBusHandler = fn; return newBus }),
      off: vi.fn(),
      emit: vi.fn()
    } as unknown as IWAEventBus

    reg.onBusConnected(newBus)

    expect(mockEventBus.off).toHaveBeenCalledWith('message:incoming', expect.any(Function))
    expect(newBus.on).toHaveBeenCalledWith('message:incoming', expect.any(Function))
    expect(newBusHandler).toBeTypeOf('function')
  })

  // S9-03
  it('cleans up subscriptions when the panel webContents is destroyed', async () => {
    registerPanelIpcHandlers(mockPanelHost, mockRouter, mockEventBus)

    let destroyedCb: (() => void) | undefined
    const sender = {
      id: 42,
      isDestroyed: () => false,
      send: vi.fn(),
      once: vi.fn((_ev: string, cb: () => void) => { destroyedCb = cb })
    }

    await (ipcMain as unknown as { _invokeHandle: Function })._invokeHandle(
      'kernel:panel:events:subscribe',
      { sender },
      { panelId: 'panel-1', eventName: 'message:incoming' }
    )

    expect(sender.once).toHaveBeenCalledWith('destroyed', expect.any(Function))
    destroyedCb?.()
    expect(mockEventBus.off).toHaveBeenCalledWith('message:incoming', expect.any(Function))
  })

  // P2-S9-06
  it('registers the destroyed cleanup hook only once per webContents across multiple subscriptions', async () => {
    registerPanelIpcHandlers(mockPanelHost, mockRouter, mockEventBus)

    const sender = {
      id: 7,
      isDestroyed: () => false,
      send: vi.fn(),
      once: vi.fn()
    }

    for (const eventName of ['message:incoming', 'message:outgoing', 'chat:updated']) {
      await (ipcMain as unknown as { _invokeHandle: Function })._invokeHandle(
        'kernel:panel:events:subscribe',
        { sender },
        { panelId: 'panel-1', eventName }
      )
    }

    expect(sender.once).toHaveBeenCalledTimes(1)
  })

  // P2-S9-06
  it('detaches a plugin\'s panel subscriptions on onPluginUnloaded', async () => {
    const reg = registerPanelIpcHandlers(mockPanelHost, mockRouter, mockEventBus)

    await (ipcMain as unknown as { _invokeHandle: Function })._invokeHandle(
      'kernel:panel:events:subscribe',
      { sender: { id: 9, isDestroyed: () => false, send: vi.fn(), once: vi.fn() } },
      { panelId: 'panel-1', eventName: 'message:incoming' }
    )

    reg.onPluginUnloaded('com.acme.plugin')

    expect(mockEventBus.off).toHaveBeenCalledWith('message:incoming', expect.any(Function))
  })

  it('cleans up handlers when unbind disposer is called', () => {
    const { dispose } = registerPanelIpcHandlers(mockPanelHost, mockRouter, mockEventBus)
    dispose()

    expect(ipcMain.removeHandler).toHaveBeenCalledWith('kernel:panel:api')
    expect(ipcMain.removeHandler).toHaveBeenCalledWith('kernel:panel:events:subscribe')
    expect(ipcMain.removeListener).toHaveBeenCalledWith('kernel:panel:events:unsubscribe', expect.any(Function))
    expect(ipcMain.removeListener).toHaveBeenCalledWith('kernel:panel:closed', expect.any(Function))
  })
})
