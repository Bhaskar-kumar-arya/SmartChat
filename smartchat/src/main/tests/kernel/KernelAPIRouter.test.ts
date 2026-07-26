import { describe, it, expect, vi } from 'vitest'
import { KernelAPIRouter } from '../../kernel/KernelAPIRouter'
import { IKernelModule } from '../../kernel/api-modules/IKernelModule'
import { DirectPluginChannel } from '../../kernel/channels/DirectPluginChannel'
import { KernelRequest, KernelResponse } from '../../kernel/channels/IPluginChannel'

describe('KernelAPIRouter', () => {
  it('routes request to registered module matching namespace', async () => {
    const router = new KernelAPIRouter()
    const mockModule: IKernelModule = {
      namespace: 'kernel:chats',
      handle: vi.fn().mockResolvedValue({ items: [{ jid: '123@s.whatsapp.net' }] })
    }

    router.registerModule(mockModule)

    const channel = new DirectPluginChannel()
    let responseSent: KernelResponse | null = null
    channel.onKernelResponse((res) => {
      responseSent = res
    })

    router.attachChannel('test-plugin', channel)

    const request: KernelRequest = {
      id: 'req-1',
      type: 'kernel:chats:getList',
      payload: { page: 1, limit: 10 }
    }

    await channel.sendFromPlugin(request)

    expect(mockModule.handle).toHaveBeenCalledWith('test-plugin', 'kernel:chats:getList', { page: 1, limit: 10 })
    expect(responseSent).toEqual({
      id: 'req-1',
      ok: true,
      payload: { items: [{ jid: '123@s.whatsapp.net' }] }
    })
  })

  it('returns NOT_FOUND for unknown namespace', async () => {
    const router = new KernelAPIRouter()
    const channel = new DirectPluginChannel()
    let responseSent: KernelResponse | null = null
    channel.onKernelResponse((res) => {
      responseSent = res
    })

    router.attachChannel('test-plugin', channel)

    const request: KernelRequest = {
      id: 'req-2',
      type: 'kernel:unknown:doThing',
      payload: {}
    }

    await channel.sendFromPlugin(request)

    expect(responseSent).toEqual({
      id: 'req-2',
      ok: false,
      error: {
        code: 'NOT_FOUND',
        message: expect.stringContaining('kernel:unknown')
      }
    })
  })

  it('catches module exceptions and returns INTERNAL_ERROR', async () => {
    const router = new KernelAPIRouter()
    const failingModule: IKernelModule = {
      namespace: 'kernel:messages',
      handle: vi.fn().mockRejectedValue(new Error('Database connection failed'))
    }

    router.registerModule(failingModule)

    const channel = new DirectPluginChannel()
    let responseSent: KernelResponse | null = null
    channel.onKernelResponse((res) => {
      responseSent = res
    })

    router.attachChannel('test-plugin', channel)

    const request: KernelRequest = {
      id: 'req-3',
      type: 'kernel:messages:send',
      payload: { jid: '123@s.whatsapp.net', text: 'Hello' }
    }

    await channel.sendFromPlugin(request)

    expect(responseSent).toEqual({
      id: 'req-3',
      ok: false,
      error: {
        code: 'INTERNAL_ERROR',
        message: 'Database connection failed'
      }
    })
  })

  it('formats PERMISSION_DENIED errors if module returns or throws permission failure', async () => {
    const router = new KernelAPIRouter()
    const permModule: IKernelModule = {
      namespace: 'kernel:contacts',
      handle: vi.fn().mockRejectedValue({
        code: 'PERMISSION_DENIED',
        message: 'Plugin lacks capability contacts:read',
        permission: 'contacts:read'
      })
    }

    router.registerModule(permModule)

    const channel = new DirectPluginChannel()
    let responseSent: KernelResponse | null = null
    channel.onKernelResponse((res) => {
      responseSent = res
    })

    router.attachChannel('test-plugin', channel)

    const request: KernelRequest = {
      id: 'req-4',
      type: 'kernel:contacts:getByJid',
      payload: { jid: '123@s.whatsapp.net' }
    }

    await channel.sendFromPlugin(request)

    expect(responseSent).toEqual({
      id: 'req-4',
      ok: false,
      error: {
        code: 'PERMISSION_DENIED',
        message: 'Plugin lacks capability contacts:read',
        permission: 'contacts:read'
      }
    })
  })

  it('routes multiple registered modules independently', async () => {
    const router = new KernelAPIRouter()
    const chatsModule: IKernelModule = {
      namespace: 'kernel:chats',
      handle: vi.fn().mockResolvedValue({ chatsCount: 5 })
    }
    const aiModule: IKernelModule = {
      namespace: 'kernel:ai',
      handle: vi.fn().mockResolvedValue({ response: 'AI response' })
    }

    router.registerModule(chatsModule)
    router.registerModule(aiModule)

    const channel = new DirectPluginChannel()
    const responses: KernelResponse[] = []
    channel.onKernelResponse((res) => {
      responses.push(res)
    })

    router.attachChannel('test-plugin', channel)

    await channel.sendFromPlugin({ id: 'r1', type: 'kernel:chats:getList', payload: {} })
    await channel.sendFromPlugin({ id: 'r2', type: 'kernel:ai:chat', payload: { prompt: 'hi' } })

    expect(chatsModule.handle).toHaveBeenCalledWith('test-plugin', 'kernel:chats:getList', {})
    expect(aiModule.handle).toHaveBeenCalledWith('test-plugin', 'kernel:ai:chat', { prompt: 'hi' })
    expect(responses).toHaveLength(2)
    expect(responses[0]).toEqual({ id: 'r1', ok: true, payload: { chatsCount: 5 } })
    expect(responses[1]).toEqual({ id: 'r2', ok: true, payload: { response: 'AI response' } })
  })
})
