import { describe, it, expect, vi } from 'vitest'
import { DirectPluginChannel } from '../../../kernel/channels/DirectPluginChannel'
import { KernelRequest, KernelResponse } from '../../../kernel/channels/IPluginChannel'

describe('DirectPluginChannel', () => {
  it('delivers request from plugin to kernel handler registered via onPluginRequest', async () => {
    const channel = new DirectPluginChannel()
    const handler = vi.fn().mockResolvedValue(undefined)

    channel.onPluginRequest(handler)

    const request: KernelRequest = {
      id: 'req-1',
      type: 'kernel:chats:getList',
      payload: { page: 1 }
    }

    await channel.sendFromPlugin(request)

    expect(handler).toHaveBeenCalledWith(request)
  })

  it('delivers request from kernel to plugin handler registered via onKernelRequest', async () => {
    const channel = new DirectPluginChannel()
    const pluginHandler = vi.fn().mockResolvedValue(undefined)

    channel.onKernelRequest(pluginHandler)

    const request: KernelRequest = {
      id: 'req-2',
      type: 'contribution:execute:chat-action',
      payload: { actionId: 'pin' }
    }

    channel.sendToPlugin(request)

    expect(pluginHandler).toHaveBeenCalledWith(request)
  })

  it('delivers response from kernel to plugin response listener', () => {
    const channel = new DirectPluginChannel()
    const responseListener = vi.fn()

    channel.onKernelResponse(responseListener)

    const response: KernelResponse = {
      id: 'req-1',
      ok: true,
      payload: { items: [] }
    }

    channel.sendResponseToPlugin(response)

    expect(responseListener).toHaveBeenCalledWith(response)
  })

  it('prevents message delivery after destroy()', async () => {
    const channel = new DirectPluginChannel()
    const pluginRequestHandler = vi.fn()
    const kernelRequestHandler = vi.fn()
    const kernelResponseHandler = vi.fn()

    channel.onPluginRequest(pluginRequestHandler)
    channel.onKernelRequest(kernelRequestHandler)
    channel.onKernelResponse(kernelResponseHandler)

    channel.destroy()

    await channel.sendFromPlugin({ id: 'req-1', type: 'test', payload: null })
    channel.sendToPlugin({ id: 'req-2', type: 'test', payload: null })
    channel.sendResponseToPlugin({ id: 'req-1', ok: true })

    expect(pluginRequestHandler).not.toHaveBeenCalled()
    expect(kernelRequestHandler).not.toHaveBeenCalled()
    expect(kernelResponseHandler).not.toHaveBeenCalled()
  })

  it('preserves correlation ID between request and response', () => {
    const channel = new DirectPluginChannel()
    const receivedResponses: KernelResponse[] = []

    channel.onKernelResponse((res) => {
      receivedResponses.push(res)
    })

    const correlationId = 'unique-correlation-123'
    channel.sendResponseToPlugin({
      id: correlationId,
      ok: true,
      payload: { data: 'test' }
    })

    expect(receivedResponses.length).toBe(1)
    expect(receivedResponses[0].id).toBe(correlationId)
  })
})
