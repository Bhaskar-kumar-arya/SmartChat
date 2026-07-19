import { describe, it, expect, vi, beforeEach } from 'vitest'
import { ExtensionEventBridge } from '../../extensions/events/ExtensionEventBridge'
import { DedicatedChatSessionManager } from '../../extensions/dedicatedChat/DedicatedChatSessionManager'
import { DedicatedChatCapabilityProvider } from '../../extensions/capabilities/providers/DedicatedChatCapabilityProvider'
import { IDedicatedChatRepository } from '../../extensions/dedicatedChat/IDedicatedChatRepository'
import { ExtensionManifest } from '../../extensions/types/ExtensionManifest'
import { IWAEventBus } from '../../services/whatsapp/IWAEventBus'
import { EventEmitter } from 'events'

describe('DedicatedChatCapabilityProvider', () => {
  let eventBridge: ExtensionEventBridge
  let mockChatRepo: IDedicatedChatRepository
  let sessionManager: DedicatedChatSessionManager
  let capabilityProvider: DedicatedChatCapabilityProvider
  let mockWindow: any
  let bus: IWAEventBus

  const manifest: ExtensionManifest = {
    id: 'test-chat-ext',
    name: 'Test Chat Ext',
    description: 'A test extension for dedicated chat capabilities',
    version: '1.0.0',
    apiVersion: '1',
    main: 'index.js',
    permissions: ['ui:dedicated_chat', 'events:message:incoming']
  }

  beforeEach(() => {
    bus = new EventEmitter() as unknown as IWAEventBus
    eventBridge = new ExtensionEventBridge(() => bus)
    
    mockChatRepo = {
      append: vi.fn().mockResolvedValue(undefined),
      getHistory: vi.fn().mockResolvedValue([]),
      clear: vi.fn().mockResolvedValue(undefined)
    }

    mockWindow = {
      webContents: {
        send: vi.fn()
      }
    }

    sessionManager = new DedicatedChatSessionManager(mockChatRepo, eventBridge, () => mockWindow)
    capabilityProvider = new DedicatedChatCapabilityProvider(mockChatRepo, () => mockWindow)
  })

  it('should not provide API if permission is missing', () => {
    const noPermManifest = { ...manifest, permissions: [] }
    const api = capabilityProvider.build(noPermManifest)
    expect(api).toBeUndefined()
  })

  it('should successfully send a message and push via IPC', async () => {
    const api = capabilityProvider.build(manifest)
    expect(api).toBeDefined()

    await api!.send({ type: 'text', text: 'pong!' })

    expect(mockChatRepo.append).toHaveBeenCalledWith(
      'test-chat-ext',
      'extension',
      JSON.stringify({ type: 'text', text: 'pong!' })
    )

    expect(mockWindow.webContents.send).toHaveBeenCalledWith('extension:chat-push', expect.objectContaining({
      extensionId: 'test-chat-ext',
      message: expect.objectContaining({
        role: 'extension',
        content: JSON.stringify({ type: 'text', text: 'pong!' })
      })
    }))
  })

  it('should route user messages to the extension event bridge', async () => {
    // Simulate extension subscribing to the chat-message event
    const handler = vi.fn()
    eventBridge.subscribeExtension('test-chat-ext', 'extension:chat-message', handler)

    // User types something in the UI
    await sessionManager.routeUserMessage('test-chat-ext', 'hello bot')

    // Repo should save it
    expect(mockChatRepo.append).toHaveBeenCalledWith(
      'test-chat-ext',
      'user',
      JSON.stringify({ type: 'text', text: 'hello bot' })
    )

    // Bridge should route it to the extension
    expect(handler).toHaveBeenCalledWith({ text: 'hello bot' })
  })

  it('should route slash commands to the extension event bridge properly formatted', async () => {
    const handler = vi.fn()
    eventBridge.subscribeExtension('test-chat-ext', 'extension:chat-message', handler)

    await sessionManager.routeUserMessage('test-chat-ext', '/ping some args')

    // It should STILL append to repo as the exact raw text typed by user
    expect(mockChatRepo.append).toHaveBeenCalledWith(
      'test-chat-ext',
      'user',
      JSON.stringify({ type: 'text', text: '/ping some args' })
    )

    // And route it to the bridge
    expect(handler).toHaveBeenCalledWith({ text: '/ping some args' })
  })
})
