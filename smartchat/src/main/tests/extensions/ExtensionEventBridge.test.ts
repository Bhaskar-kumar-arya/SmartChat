import { describe, it, expect, vi, beforeEach } from 'vitest'
import { ExtensionEventBridge } from '../../extensions/events/ExtensionEventBridge'
import { IWAEventBus } from '../../services/whatsapp/IWAEventBus'

describe('ExtensionEventBridge', () => {
  let mockBus: any
  let bridge: ExtensionEventBridge

  beforeEach(() => {
    mockBus = {
      on: vi.fn(),
      emit: vi.fn(),
      off: vi.fn(),
      removeAllListeners: vi.fn()
    }
    bridge = new ExtensionEventBridge(() => mockBus as unknown as IWAEventBus)
  })

  it('subscribes to message:incoming and strips sensitive payloads', () => {
    const handler = vi.fn()
    const unsubscribe = bridge.subscribeExtension('test-ext', 'message:incoming', handler)

    // Simulate waEventBus emitting a message
    const rawPayload = {
      chatJid: '123@s.whatsapp.net',
      senderJid: '456@s.whatsapp.net',
      textContent: 'hello',
      fromMe: false,
      timestamp: 12345n,
      processed: { /* sensitive db row */ },
      sock: { /* sensitive sock */ },
      enriched: {}
    }

    // Call the listener registered by the bridge
    const listener = mockBus.on.mock.calls.find((c: any) => c[0] === 'message:incoming')[1]
    listener(rawPayload)

    expect(handler).toHaveBeenCalledWith({
      chatJid: '123@s.whatsapp.net',
      senderJid: '456@s.whatsapp.net',
      textContent: 'hello',
      fromMe: false,
      timestamp: 12345n,
      enriched: {}
    })
    
    // Check that sensitive fields are missing
    const callArgs = handler.mock.calls[0][0]
    expect(callArgs.sock).toBeUndefined()
    expect(callArgs.processed).toBeUndefined()

    unsubscribe()
  })

  it('unsubscribes all listeners for an extension', () => {
    const handler1 = vi.fn()
    const handler2 = vi.fn()
    
    bridge.subscribeExtension('test-ext', 'message:incoming', handler1)
    bridge.subscribeExtension('test-ext', 'chat:created', handler2)

    bridge.unsubscribeAll('test-ext')

    const listener = mockBus.on.mock.calls.find((c: any) => c[0] === 'message:incoming')[1]
    listener({ chatJid: '1', senderJid: '2', textContent: 'hi' })

    expect(handler1).not.toHaveBeenCalled()
  })
})
