import { describe, it, expect, vi } from 'vitest'
import { MessageChannel } from 'node:worker_threads'
import { WorkerPluginChannel, PLUGIN_REQUEST_TIMEOUT_MS } from '../../../kernel/channels/WorkerPluginChannel'
import { KernelRequest, KernelResponse } from '../../../kernel/channels/IPluginChannel'

describe('WorkerPluginChannel', () => {
  it('delivers kernel requests to port2 and plugin requests to onPluginRequest', async () => {
    const { port1, port2 } = new MessageChannel()
    const channel = new WorkerPluginChannel(port1)

    const pluginRequestHandler = vi.fn().mockResolvedValue(undefined)
    channel.onPluginRequest(pluginRequestHandler)

    const receivedOnPort2: unknown[] = []
    port2.on('message', (msg) => {
      receivedOnPort2.push(msg)
    })

    const requestToPlugin: KernelRequest = {
      id: 'req-1',
      type: 'contribution:execute:action',
      payload: { key: 'value' }
    }
    channel.sendToPlugin(requestToPlugin)

    // Wait for message tick
    await new Promise((resolve) => setTimeout(resolve, 50))

    expect(receivedOnPort2).toHaveLength(1)
    expect(receivedOnPort2[0]).toEqual(requestToPlugin)

    const requestFromPlugin: KernelRequest = {
      id: 'req-2',
      type: 'kernel:chats:getList',
      payload: { page: 1 }
    }
    port2.postMessage(requestFromPlugin)

    await new Promise((resolve) => setTimeout(resolve, 50))

    expect(pluginRequestHandler).toHaveBeenCalledWith(requestFromPlugin)

    channel.destroy()
    port2.close()
  })

  it('delivers kernel response back to worker port', async () => {
    const { port1, port2 } = new MessageChannel()
    const channel = new WorkerPluginChannel(port1)

    const receivedResponses: unknown[] = []
    port2.on('message', (msg) => {
      receivedResponses.push(msg)
    })

    const response: KernelResponse = {
      id: 'req-2',
      ok: true,
      payload: { success: true }
    }
    channel.sendResponseToPlugin(response)

    await new Promise((resolve) => setTimeout(resolve, 50))

    expect(receivedResponses).toHaveLength(1)
    expect(receivedResponses[0]).toEqual(response)

    channel.destroy()
    port2.close()
  })

  it('supports request/response correlation with pending promises', async () => {
    const { port1, port2 } = new MessageChannel()
    const channel = new WorkerPluginChannel(port1)

    // Simulate worker listening on port2 and replying when it receives a request
    port2.on('message', (msg: KernelRequest) => {
      if (msg.type === 'ping') {
        const response: KernelResponse = {
          id: msg.id,
          ok: true,
          payload: { pong: true }
        }
        port2.postMessage(response)
      }
    })

    const responsePromise = channel.sendRequestToPlugin({
      id: 'req-ping',
      type: 'ping',
      payload: null
    })

    const result = await responsePromise
    expect(result).toEqual({ id: 'req-ping', ok: true, payload: { pong: true } })

    channel.destroy()
    port2.close()
  })

  it('throws or rejects on non-serializable payloads', () => {
    const { port1, port2 } = new MessageChannel()
    const channel = new WorkerPluginChannel(port1)

    const nonSerializableRequest: KernelRequest = {
      id: 'req-bad',
      type: 'kernel:test',
      payload: { fn: () => {} }
    }

    expect(() => {
      channel.sendToPlugin(nonSerializableRequest)
    }).toThrow()

    channel.destroy()
    port2.close()
  })

  it('rejects all pending promises on destroy()', async () => {
    const { port1, port2 } = new MessageChannel()
    const channel = new WorkerPluginChannel(port1)

    const pendingPromise = channel.sendRequestToPlugin({
      id: 'req-never-replied',
      type: 'kernel:chats:getList',
      payload: {}
    })

    channel.destroy()
    port2.close()

    await expect(pendingPromise).rejects.toThrow('Channel destroyed')
  })

  // S9-04
  it('rejects a pending request with PLUGIN_TIMEOUT when the plugin never replies', async () => {
    vi.useFakeTimers()
    try {
      const { port1, port2 } = new MessageChannel()
      const channel = new WorkerPluginChannel(port1)

      const pending = channel.sendRequestToPlugin({ id: 'r-hang', type: 'contribution:execute:ai-tool', payload: {} })
      const assertion = expect(pending).rejects.toThrow(/PLUGIN_TIMEOUT/)
      await vi.advanceTimersByTimeAsync(PLUGIN_REQUEST_TIMEOUT_MS + 1)
      await assertion

      channel.destroy()
      port2.close()
    } finally {
      vi.useRealTimers()
    }
  })
})
