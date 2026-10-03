import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { registerAllIpc, trustedEvent, untrustedEvent } from './ipcHarness'
import type { ipcMainRecorder } from '../electron-mock'
import type { WASocket } from '../../services/whatsapp/types'

vi.mock('../../services/ai/AIToolInitializer', () => ({
  AIToolInitializer: { initializeAll: vi.fn() }
}))

// N-05: handler-level characterization through the recording ipcMain.
// Behaviour pinned here is today's; where a later unit changes it the test is
// updated in that unit's fix commit.

type Recorder = typeof ipcMainRecorder

const fakeSock = { user: { id: 'me@s.whatsapp.net' } } as unknown as WASocket

describe('IPC handlers via recording ipcMain', () => {
  beforeEach(() => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    vi.spyOn(console, 'error').mockImplementation(() => {})
    vi.spyOn(console, 'log').mockImplementation(() => {})
  })
  afterEach(() => {
    vi.restoreAllMocks()
  })

  describe('socket guard', () => {
    const socketGuarded: Array<[string, unknown[]]> = [
      ['send-message', ['a@s.whatsapp.net', 'hi']],
      ['edit-message', ['a@s.whatsapp.net', 'm1', 'new']],
      ['delete-message', ['a@s.whatsapp.net', 'm1']],
      ['react-message', ['a@s.whatsapp.net', 'm1', 'x']],
      ['send-media-message', ['a@s.whatsapp.net', '/tmp/f.png']],
      ['mute-chat', ['a@s.whatsapp.net', 1000]],
      ['unmute-chat', ['a@s.whatsapp.net']],
      ['pin-chat', ['a@s.whatsapp.net']],
      ['unpin-chat', ['a@s.whatsapp.net']]
    ]

    it.each(socketGuarded)('%s rejects when the WhatsApp socket is not connected', async (channel, args) => {
      const messageActionService = { sendMessageWorkflow: vi.fn() }
      const ipc = registerAllIpc({ services: { messageActionService }, getSock: () => null })
      await expect(ipc.invoke(channel, trustedEvent, ...args)).rejects.toThrow(
        '[IPC] WhatsApp socket is not connected'
      )
      expect(messageActionService.sendMessageWorkflow).not.toHaveBeenCalled()
    })

    it('send-message forwards to the workflow with the live socket and all args', async () => {
      const sendMessageWorkflow = vi.fn().mockResolvedValue({ id: 'm1' })
      const ipc = registerAllIpc({
        services: { messageActionService: { sendMessageWorkflow } },
        getSock: () => fakeSock
      })
      const result = await ipc.invoke('send-message', trustedEvent, 'j', 'hello', 'q1', ['x'])
      expect(result).toEqual({ id: 'm1' })
      expect(sendMessageWorkflow).toHaveBeenCalledWith(fakeSock, 'j', 'hello', 'q1', ['x'])
    })

    it('mute-chat passes the duration, unmute-chat passes null, both resolve true', async () => {
      const muteChat = vi.fn().mockResolvedValue(undefined)
      const ipc = registerAllIpc({ services: { chatActionService: { muteChat } }, getSock: () => fakeSock })
      await expect(ipc.invoke('mute-chat', trustedEvent, 'j', 5000)).resolves.toBe(true)
      await expect(ipc.invoke('unmute-chat', trustedEvent, 'j')).resolves.toBe(true)
      expect(muteChat).toHaveBeenNthCalledWith(1, fakeSock, 'j', 5000)
      expect(muteChat).toHaveBeenNthCalledWith(2, fakeSock, 'j', null)
    })
  })

  describe('isTrustedSender rejections', () => {
    const guarded: Array<[string, unknown[], string]> = [
      ['save-temp-file', [new Uint8Array([1]), 'a.bin'], 'save-temp-file cannot be invoked from this context'],
      ['download-url-to-temp', ['https://example.com/a', 'a.bin'], 'download-url-to-temp cannot be invoked from this context'],
      ['clear-vectors', [], 'clear-vectors cannot be invoked from this context'],
      ['get-provider-keys', [], 'get-provider-keys cannot be invoked from this context'],
      ['set-provider-key', ['openai', 'k'], 'set-provider-key cannot be invoked from this context'],
      ['set-sync-full-history', [true], 'set-sync-full-history cannot be invoked from this context']
    ]

    it.each(guarded)('%s rejects an untrusted frame before touching any service', async (channel, args, message) => {
      const aiService = { getProviderKeys: vi.fn(), setProviderKey: vi.fn() }
      const embeddingService = { clearAllVectors: vi.fn(), setOnActiveStateSync: vi.fn() }
      const authSettingsService = { setSyncFullHistory: vi.fn() }
      const ipc = registerAllIpc({ services: { aiService, embeddingService, authSettingsService } })
      await expect(ipc.invoke(channel, untrustedEvent, ...args)).rejects.toThrow(message)
      expect(aiService.getProviderKeys).not.toHaveBeenCalled()
      expect(aiService.setProviderKey).not.toHaveBeenCalled()
      expect(embeddingService.clearAllVectors).not.toHaveBeenCalled()
      expect(authSettingsService.setSyncFullHistory).not.toHaveBeenCalled()
    })

    it('rejects a sub-frame and a missing senderFrame as untrusted', async () => {
      const ipc = registerAllIpc()
      await expect(ipc.invoke('get-provider-keys', { senderFrame: null })).rejects.toThrow('cannot be invoked')
      await expect(ipc.invoke('get-provider-keys', {})).rejects.toThrow('cannot be invoked')
    })

    it('get-provider-keys serves a trusted frame', async () => {
      const getProviderKeys = vi.fn().mockResolvedValue({ openai: 'sk-x' })
      const ipc = registerAllIpc({ services: { aiService: { getProviderKeys } } })
      await expect(ipc.invoke('get-provider-keys', trustedEvent)).resolves.toEqual({ openai: 'sk-x' })
    })

    it('execute-tool: unknown tool rejects; permission-gated tool from an untrusted frame is refused unexecuted', async () => {
      const execute = vi.fn()
      const toolRegistry = {
        getTool: (name: string) =>
          name === 'send-as-user' ? { name, requiresPermission: true, description: 'd', execute } : undefined
      }
      const ipc = registerAllIpc({ services: { toolRegistry } })
      await expect(ipc.invoke('execute-tool', trustedEvent, 'nope', {})).rejects.toThrow('Tool nope not found')
      await expect(ipc.invoke('execute-tool', untrustedEvent, 'send-as-user', {})).rejects.toThrow(
        'requires permission and cannot be invoked from this context'
      )
      expect(execute).not.toHaveBeenCalled()
    })

    it('execute-tool runs a non-permission tool from any frame', async () => {
      const execute = vi.fn().mockResolvedValue({ ok: true })
      const toolRegistry = { getTool: () => ({ name: 't', requiresPermission: false, execute }) }
      const ipc = registerAllIpc({ services: { toolRegistry } })
      await expect(ipc.invoke('execute-tool', untrustedEvent, 't', { a: 1 })).resolves.toEqual({ ok: true })
      expect(execute).toHaveBeenCalledWith({ a: 1 }, undefined)
    })
  })

  describe('download-url-to-temp validation (trusted frame)', () => {
    it('rejects an unparseable URL and a non-https protocol before any I/O', async () => {
      const ipc = registerAllIpc()
      await expect(ipc.invoke('download-url-to-temp', trustedEvent, 'not a url', 'a.bin')).rejects.toThrow('invalid URL')
      await expect(
        ipc.invoke('download-url-to-temp', trustedEvent, 'http://localhost/x', 'a.bin')
      ).rejects.toThrow("unsupported protocol 'http:'")
    })
  })

  describe('embedding failure behaviour (B-APP-04: errors are swallowed today)', () => {
    it('index-embeddings resolves undefined even when indexing throws (renderer progress is never cleared)', async () => {
      const embeddingService = {
        setOnActiveStateSync: vi.fn(),
        indexAll: vi.fn().mockRejectedValue(new Error('boom'))
      }
      const ipc = registerAllIpc({ services: { embeddingService } })
      await expect(ipc.invoke('index-embeddings', trustedEvent)).resolves.toBeUndefined()
      expect(embeddingService.indexAll).toHaveBeenCalledTimes(1)
    })

    it('clear-vectors resolves undefined even when clearing throws', async () => {
      const embeddingService = {
        setOnActiveStateSync: vi.fn(),
        clearAllVectors: vi.fn().mockRejectedValue(new Error('boom'))
      }
      const ipc = registerAllIpc({ services: { embeddingService } })
      await expect(ipc.invoke('clear-vectors', trustedEvent)).resolves.toBeUndefined()
      expect(embeddingService.clearAllVectors).toHaveBeenCalledTimes(1)
    })

    it.fails('index-embeddings rejects (and sends no 100% progress) when indexing throws (B-APP-04 target)', async () => {
      const embeddingService = {
        setOnActiveStateSync: vi.fn(),
        indexAll: vi.fn().mockRejectedValue(new Error('boom'))
      }
      const ipc = registerAllIpc({ services: { embeddingService } })
      await expect(ipc.invoke('index-embeddings', trustedEvent)).rejects.toThrow('boom')
    })

    it.fails('clear-vectors rejects when clearing throws (B-APP-04 target)', async () => {
      const embeddingService = {
        setOnActiveStateSync: vi.fn(),
        clearAllVectors: vi.fn().mockRejectedValue(new Error('boom'))
      }
      const ipc = registerAllIpc({ services: { embeddingService } })
      await expect(ipc.invoke('clear-vectors', trustedEvent)).rejects.toThrow('boom')
    })

    it('registration wires embeddingService.setOnActiveStateSync with a callback', () => {
      const setOnActiveStateSync = vi.fn()
      registerAllIpc({ services: { embeddingService: { setOnActiveStateSync } } })
      expect(setOnActiveStateSync).toHaveBeenCalledWith(expect.any(Function))
    })
  })

  describe('ai-chat-stream (ipcMain.on)', () => {
    async function runStream(ipc: Recorder): Promise<ReturnType<typeof vi.fn>> {
      const send = vi.fn()
      const listeners = ipc.getListeners('ai-chat-stream')
      expect(listeners).toHaveLength(1)
      await listeners[0]({ sender: { send } }, { channelId: 'c1', prompt: 'p' })
      return send
    }

    const aiChatSessionService = { getAIOptions: vi.fn().mockResolvedValue({ contextLength: 4096 }) }

    it('streams chunks then end on success', async () => {
      const generateResponseStream = vi
        .fn()
        .mockImplementation(async (_p, _c, _h, _m, _o, onChunk: (c: string) => void) => {
          onChunk('a')
          onChunk('b')
        })
      const ipc = registerAllIpc({ services: { aiService: { generateResponseStream }, aiChatSessionService } })
      const send = await runStream(ipc)
      expect(send.mock.calls).toEqual([['c1-chunk', 'a'], ['c1-chunk', 'b'], ['c1-end']])
      expect(generateResponseStream.mock.calls[0][4]).toEqual({ contextLength: 4096, requestId: 'c1' })
    })

    it('turns an abort into end, and any other failure into an error string payload', async () => {
      const abort = Object.assign(new Error('aborted'), { name: 'AbortError' })
      const ipcAbort = registerAllIpc({
        services: { aiService: { generateResponseStream: vi.fn().mockRejectedValue(abort) }, aiChatSessionService }
      })
      expect((await runStream(ipcAbort)).mock.calls).toEqual([['c1-end']])

      const ipcFail = registerAllIpc({
        services: {
          aiService: { generateResponseStream: vi.fn().mockRejectedValue(new Error('quota')) },
          aiChatSessionService
        }
      })
      // M4: error is a string, though the preload/typings declare Error.
      expect((await runStream(ipcFail)).mock.calls).toEqual([['c1-error', 'quota']])
    })
  })

  describe('misc handlers', () => {
    it('get-chat maps a found chat and returns null when missing', async () => {
      const getChatByJid = vi
        .fn()
        .mockResolvedValueOnce({ jid: 'j', name: 'N', unreadCount: 2, extraField: 'dropped' })
        .mockResolvedValueOnce(null)
      const ipc = registerAllIpc({ services: { chatService: { getChatByJid } } })
      const found = (await ipc.invoke('get-chat', trustedEvent, 'j')) as Record<string, unknown>
      expect(found).toMatchObject({ jid: 'j', name: 'N', unreadCount: 2 })
      expect(found).not.toHaveProperty('extraField')
      await expect(ipc.invoke('get-chat', trustedEvent, 'gone')).resolves.toBeNull()
    })

    it('abort-ai-chat aborts the request and resolves true', async () => {
      const abortResponse = vi.fn()
      const ipc = registerAllIpc({ services: { aiService: { abortResponse } } })
      await expect(ipc.invoke('abort-ai-chat', trustedEvent, 'req1')).resolves.toBe(true)
      expect(abortResponse).toHaveBeenCalledWith('req1')
    })

    it('search-all parses ISO date filters into Dates and defaults mode to normal', async () => {
      const searchAll = vi.fn().mockResolvedValue({})
      const ipc = registerAllIpc({ services: { searchService: { searchAll } }, getSock: () => null })
      await ipc.invoke('search-all', trustedEvent, 'q', undefined, { jids: ['j'], fromDate: '2024-01-02T00:00:00.000Z' })
      expect(searchAll).toHaveBeenCalledWith('q', 'normal', null, {
        jids: ['j'],
        fromDate: new Date('2024-01-02T00:00:00.000Z'),
        toDate: undefined
      })
    })
  })
})
