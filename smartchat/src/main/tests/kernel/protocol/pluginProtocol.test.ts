import { describe, it, expect, vi, beforeEach } from 'vitest'
import { net } from 'electron'
import { registerPluginProtocol, resetRegisteredSessions } from '../../../protocol/pluginProtocol'

const { mockHandle } = vi.hoisted(() => ({
  mockHandle: vi.fn()
}))

vi.mock('electron', () => ({
  protocol: {
    handle: mockHandle
  },
  session: {
    defaultSession: {
      protocol: {
        handle: mockHandle
      }
    }
  },
  app: {
    on: vi.fn()
  },
  net: {
    fetch: vi.fn()
  }
}))

describe('pluginProtocol', () => {
  const extensionsPath = 'C:/Users/test/userData/extensions'

  beforeEach(() => {
    vi.clearAllMocks()
    resetRegisteredSessions()
  })

  it('registers plugin protocol with electron', () => {
    registerPluginProtocol(extensionsPath)
    expect(mockHandle).toHaveBeenCalledWith('plugin', expect.any(Function))
  })

  it('resolves valid plugin URL to file URL', async () => {
    registerPluginProtocol(extensionsPath)
    const handler = mockHandle.mock.calls[0][1]

    const fakeRequest = {
      url: 'plugin://com.smartchat.voice-transcriber/overlays/transcribe.html'
    } as any

    vi.mocked(net.fetch).mockReturnValue(new Response('OK') as any)

    await handler(fakeRequest)

    expect(net.fetch).toHaveBeenCalled()
    const fetchUrl = vi.mocked(net.fetch).mock.calls[0][0] as string
    expect(fetchUrl).toContain('com.smartchat.voice-transcriber')
    expect(fetchUrl).toContain('transcribe.html')
  })

  it('rejects path traversal attempts with 403 Forbidden', async () => {
    registerPluginProtocol(extensionsPath)
    const handler = mockHandle.mock.calls[0][1]

    // Construct a URL where pathname tries escaping plugin directory
    const fakeRequest = {
      url: 'plugin://com.smartchat.voice-transcriber/%2e%2e%2fother-plugin%2fsecret.txt'
    } as any

    const response = (await handler(fakeRequest)) as Response
    expect(response.status).toBe(403)
  })
})
