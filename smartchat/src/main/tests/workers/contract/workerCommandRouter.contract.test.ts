import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

vi.mock('worker_threads', async () =>
  (await import('../../helpers/waFakes')).createWorkerThreadsModule()
)

import { WorkerCommandRouter } from '../../../workers/whatsapp/routing/workerCommandRouter'
import type { WorkerConnectionManager } from '../../../workers/whatsapp/socket/workerConnectionManager'
import type { WorkerCommandMessage } from '../../../workers/whatsapp/whatsappWorker.types'
import { createFakeBaileysSocket, fakeParentPort } from '../../helpers/waFakes'

/**
 * N-02 / R-WA-01: pins the worker-side half of the worker<->main contract:
 * for every WorkerCommandMessage the router calls a specific socket method with
 * a specific argument shape and posts a specific reply shape.
 */

type Repos = { historySyncManager: { skipSync: ReturnType<typeof vi.fn> } }
type FakeSock = ReturnType<typeof createFakeBaileysSocket>

function setup(opts: { sock?: FakeSock | null; repos?: Repos | null } = {}) {
  const sock = opts.sock === undefined ? createFakeBaileysSocket() : opts.sock
  const repos = opts.repos === undefined ? null : opts.repos
  const connectionManager = {
    getSocket: vi.fn(() => sock),
    getRepos: vi.fn(() => repos),
    setup: vi.fn(),
    connect: vi.fn(async () => undefined)
  }
  const bootstrap = vi.fn(async () => ({ prisma: { tag: 'prisma' }, repos: { tag: 'repos' } }))
  const router = new WorkerCommandRouter(
    connectionManager as unknown as WorkerConnectionManager,
    bootstrap as unknown as ConstructorParameters<typeof WorkerCommandRouter>[1]
  )
  return { router, sock: sock as FakeSock, connectionManager, bootstrap }
}

describe('WorkerCommandRouter contract (N-02)', () => {
  beforeEach(() => {
    fakeParentPort.reset()
    vi.spyOn(console, 'log').mockImplementation(() => undefined)
    vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
  })
  afterEach(() => vi.restoreAllMocks())

  it('init: bootstraps, sets up the manager, connects, then replies {status:"initialized"}', async () => {
    const { router, connectionManager, bootstrap } = setup()
    const order: string[] = []
    bootstrap.mockImplementation(async () => {
      order.push('bootstrap')
      return { prisma: { tag: 'prisma' }, repos: { tag: 'repos' } }
    })
    connectionManager.setup.mockImplementation(() => order.push('setup'))
    connectionManager.connect.mockImplementation(async () => {
      order.push('connect')
    })

    await router.handleCommand({
      type: 'init',
      correlationId: 'init-call',
      payload: { dbPath: '/db', userDataPath: '/ud', syncFullHistory: true, shouldSyncHistory: false }
    })

    expect(bootstrap).toHaveBeenCalledWith('/db', '/ud')
    expect(connectionManager.setup).toHaveBeenCalledWith('/ud', true, { tag: 'prisma' }, { tag: 'repos' })
    expect(order).toEqual(['bootstrap', 'setup', 'connect'])
    expect(fakeParentPort.posted).toEqual([
      { type: 'reply', correlationId: 'init-call', payload: { result: { status: 'initialized' } } }
    ])
  })

  it('init failure: replies reply_error with the error message and does not connect (B-WA-04 worker half)', async () => {
    const { router, connectionManager, bootstrap } = setup()
    bootstrap.mockRejectedValue(new Error('SQLITE_BUSY'))

    await router.handleCommand({
      type: 'init',
      correlationId: 'init-call',
      payload: { dbPath: '/db', userDataPath: '/ud', syncFullHistory: false, shouldSyncHistory: false }
    })

    expect(connectionManager.connect).not.toHaveBeenCalled()
    expect(fakeParentPort.posted).toEqual([
      { type: 'reply_error', correlationId: 'init-call', error: 'SQLITE_BUSY' }
    ])
  })

  it('send_message: forwards (jid, content, options) and replies the raw send result', async () => {
    const { router, sock } = setup()
    sock.sendMessage.mockResolvedValue({ key: { id: 'M1' } })

    await router.handleCommand({
      type: 'send_message',
      correlationId: 'c1',
      payload: { jid: 'a@s.whatsapp.net', content: { text: 'hi' }, options: { quoted: { id: 'q' } } }
    })

    expect(sock.sendMessage).toHaveBeenCalledWith('a@s.whatsapp.net', { text: 'hi' }, { quoted: { id: 'q' } })
    expect(fakeParentPort.posted).toEqual([
      { type: 'reply', correlationId: 'c1', payload: { result: { key: { id: 'M1' } } } }
    ])
  })

  it('send_message: restores Uint8Array payloads to Buffers before calling Baileys', async () => {
    const { router, sock } = setup()
    await router.handleCommand({
      type: 'send_message',
      correlationId: 'c1',
      payload: { jid: 'j', content: { image: new Uint8Array([1, 2, 3]) } }
    })
    const content = sock.sendMessage.mock.calls[0][1] as { image: unknown }
    expect(Buffer.isBuffer(content.image)).toBe(true)
    expect(Array.from(content.image as Buffer)).toEqual([1, 2, 3])
  })

  it('read_messages: forwards keys and replies {status:"success"}', async () => {
    const { router, sock } = setup()
    const keys = [{ remoteJid: 'j', id: '1' }]
    await router.handleCommand({ type: 'read_messages', correlationId: 'c2', payload: { keys } })
    expect(sock.readMessages).toHaveBeenCalledWith(keys)
    expect(fakeParentPort.posted).toEqual([
      { type: 'reply', correlationId: 'c2', payload: { result: { status: 'success' } } }
    ])
  })

  it('chat_modify: calls chatModify(modification, jid) (arg order swapped vs payload) and replies success', async () => {
    const { router, sock } = setup()
    await router.handleCommand({
      type: 'chat_modify',
      correlationId: 'c3',
      payload: { jid: 'j', modification: { archive: true } }
    })
    expect(sock.chatModify).toHaveBeenCalledWith({ archive: true }, 'j')
    expect(fakeParentPort.posted).toEqual([
      { type: 'reply', correlationId: 'c3', payload: { result: { status: 'success' } } }
    ])
  })

  it('group_fetch_all: replies the groups wrapped as {groups} (bridge is typed otherwise: B-WA-15)', async () => {
    const { router, sock } = setup()
    sock.groupFetchAllParticipating.mockResolvedValue({ 'g@g.us': { id: 'g@g.us' } })
    await router.handleCommand({ type: 'group_fetch_all', correlationId: 'c4' })
    expect(fakeParentPort.posted).toEqual([
      { type: 'reply', correlationId: 'c4', payload: { result: { groups: { 'g@g.us': { id: 'g@g.us' } } } } }
    ])
  })

  it('get_pn_for_lid: replies the mapped PN as a bare result', async () => {
    const { router, sock } = setup()
    await router.handleCommand({ type: 'get_pn_for_lid', correlationId: 'c5', payload: { lid: 'x@lid' } })
    expect(sock.signalRepository.lidMapping.getPNForLID).toHaveBeenCalledWith('x@lid')
    expect(fakeParentPort.posted).toEqual([
      { type: 'reply', correlationId: 'c5', payload: { result: '2222@s.whatsapp.net' } }
    ])
  })

  it('profile_picture_url: forwards (jid, type) and replies the bare url', async () => {
    const { router, sock } = setup()
    await router.handleCommand({
      type: 'profile_picture_url',
      correlationId: 'c6',
      payload: { jid: 'j', type: 'preview' }
    })
    expect(sock.profilePictureUrl).toHaveBeenCalledWith('j', 'preview')
    expect(fakeParentPort.posted).toEqual([
      { type: 'reply', correlationId: 'c6', payload: { result: 'https://pp.example/img.jpg' } }
    ])
  })

  it('profile_picture_url: expected item-not-found error is replied as reply_error without console.error noise', async () => {
    const { router, sock } = setup()
    sock.profilePictureUrl.mockRejectedValue(new Error('item-not-found'))
    await router.handleCommand({
      type: 'profile_picture_url',
      correlationId: 'c6b',
      payload: { jid: 'j', type: 'image' }
    })
    expect(fakeParentPort.posted).toEqual([
      { type: 'reply_error', correlationId: 'c6b', error: 'item-not-found' }
    ])
    expect(console.error).not.toHaveBeenCalled()
  })

  it('profile_picture_url: other errors are logged via console.error and replied as reply_error', async () => {
    const { router, sock } = setup()
    sock.profilePictureUrl.mockRejectedValue(new Error('boom'))
    await router.handleCommand({
      type: 'profile_picture_url',
      correlationId: 'c6c',
      payload: { jid: 'j', type: 'image' }
    })
    expect(console.error).toHaveBeenCalled()
    expect(fakeParentPort.posted).toEqual([{ type: 'reply_error', correlationId: 'c6c', error: 'boom' }])
  })

  it('update_media_message: restores buffers in, sanitizes (bigint -> number, drops functions) out', async () => {
    const { router, sock } = setup()
    sock.updateMediaMessage.mockResolvedValue({ n: BigInt(5), fn: () => 1, keep: 'x' })
    await router.handleCommand({
      type: 'update_media_message',
      correlationId: 'c7',
      payload: { msg: { key: { id: '1' }, buf: new Uint8Array([9]) } }
    })
    const arg = sock.updateMediaMessage.mock.calls[0][0] as { buf: unknown }
    expect(Buffer.isBuffer(arg.buf)).toBe(true)
    expect(fakeParentPort.posted).toEqual([
      { type: 'reply', correlationId: 'c7', payload: { result: { n: 5, keep: 'x' } } }
    ])
  })

  it('update_media_message: replies reply_error when the socket lacks updateMediaMessage', async () => {
    const sock = createFakeBaileysSocket()
    ;(sock as unknown as { updateMediaMessage: undefined }).updateMediaMessage = undefined
    const { router } = setup({ sock })
    await router.handleCommand({ type: 'update_media_message', correlationId: 'c7b', payload: { msg: {} } })
    expect(fakeParentPort.posted).toEqual([
      {
        type: 'reply_error',
        correlationId: 'c7b',
        error: '[WhatsAppWorker] Socket does not support updateMediaMessage'
      }
    ])
  })

  it('group_metadata: replies the metadata as a bare result', async () => {
    const { router, sock } = setup()
    await router.handleCommand({ type: 'group_metadata', correlationId: 'c8', payload: { jid: 'g@g.us' } })
    expect(sock.groupMetadata).toHaveBeenCalledWith('g@g.us')
    expect(fakeParentPort.posted).toEqual([
      {
        type: 'reply',
        correlationId: 'c8',
        payload: { result: { id: 'g@g.us', subject: 'Group', participants: [] } }
      }
    ])
  })

  it('logout: calls sock.logout and replies {status:"success"}', async () => {
    const { router, sock } = setup()
    await router.handleCommand({ type: 'logout', correlationId: 'c9' })
    expect(sock.logout).toHaveBeenCalledTimes(1)
    expect(fakeParentPort.posted).toEqual([
      { type: 'reply', correlationId: 'c9', payload: { result: { status: 'success' } } }
    ])
  })

  it('skip_sync: passes the socket to historySyncManager.skipSync; non-deferred maps to success, deferred stays deferred', async () => {
    const skipSync = vi.fn().mockResolvedValueOnce('completed').mockResolvedValueOnce('deferred')
    const { router, sock } = setup({ repos: { historySyncManager: { skipSync } } })
    await router.handleCommand({ type: 'skip_sync', correlationId: 'a' })
    await router.handleCommand({ type: 'skip_sync', correlationId: 'b' })
    expect(skipSync).toHaveBeenNthCalledWith(1, sock)
    expect(fakeParentPort.posted).toEqual([
      { type: 'reply', correlationId: 'a', payload: { result: { status: 'success' } } },
      { type: 'reply', correlationId: 'b', payload: { result: { status: 'deferred' } } }
    ])
  })

  it('skip_sync: replies reply_error "Repositories not initialized" when repos are missing', async () => {
    const { router } = setup({ repos: null })
    await router.handleCommand({ type: 'skip_sync', correlationId: 'x' })
    expect(fakeParentPort.posted).toEqual([
      { type: 'reply_error', correlationId: 'x', error: 'Repositories not initialized' }
    ])
  })

  it('fetch_message_history: maps payload to (count, {remoteJid,id,fromMe}, tsMs) and replies {requestId}', async () => {
    const { router, sock } = setup()
    sock.fetchMessageHistory.mockResolvedValue('REQ-9')
    await router.handleCommand({
      type: 'fetch_message_history',
      correlationId: 'c10',
      payload: { count: 50, jid: 'j', oldestMsgId: 'M', oldestMsgFromMe: true, oldestMsgTimestampMs: 1234 }
    })
    expect(sock.fetchMessageHistory).toHaveBeenCalledWith(50, { remoteJid: 'j', id: 'M', fromMe: true }, 1234)
    expect(fakeParentPort.posted).toEqual([
      { type: 'reply', correlationId: 'c10', payload: { result: { requestId: 'REQ-9' } } }
    ])
  })

  it('fetch_message_history: reply_error when the socket lacks fetchMessageHistory', async () => {
    const sock = createFakeBaileysSocket()
    ;(sock as unknown as { fetchMessageHistory: undefined }).fetchMessageHistory = undefined
    const { router } = setup({ sock })
    await router.handleCommand({
      type: 'fetch_message_history',
      correlationId: 'c11',
      payload: { count: 1, jid: 'j', oldestMsgId: 'M', oldestMsgFromMe: false, oldestMsgTimestampMs: 1 }
    })
    expect(fakeParentPort.posted).toEqual([
      {
        type: 'reply_error',
        correlationId: 'c11',
        error: '[WhatsAppWorker] Socket does not support fetchMessageHistory'
      }
    ])
  })

  describe('error path', () => {
    const socketCommands: WorkerCommandMessage[] = [
      { type: 'send_message', correlationId: 'e1', payload: { jid: 'j', content: {} } },
      { type: 'read_messages', correlationId: 'e2', payload: { keys: [] } },
      { type: 'chat_modify', correlationId: 'e3', payload: { jid: 'j', modification: {} } },
      { type: 'group_fetch_all', correlationId: 'e4' },
      { type: 'get_pn_for_lid', correlationId: 'e5', payload: { lid: 'l' } },
      { type: 'profile_picture_url', correlationId: 'e6', payload: { jid: 'j', type: 'image' } },
      { type: 'update_media_message', correlationId: 'e7', payload: { msg: {} } },
      { type: 'group_metadata', correlationId: 'e8', payload: { jid: 'j' } },
      { type: 'logout', correlationId: 'e9' },
      { type: 'skip_sync', correlationId: 'e10' },
      {
        type: 'fetch_message_history',
        correlationId: 'e11',
        payload: { count: 1, jid: 'j', oldestMsgId: 'm', oldestMsgFromMe: false, oldestMsgTimestampMs: 1 }
      }
    ]

    it.each(socketCommands.map((c) => [c.type, c] as const))(
      '%s: with no socket replies reply_error "Socket not initialized" carrying the correlationId',
      async (_type, command) => {
        const { router } = setup({ sock: null })
        await router.handleCommand(command)
        expect(fakeParentPort.posted).toEqual([
          { type: 'reply_error', correlationId: command.correlationId, error: 'Socket not initialized' }
        ])
      }
    )

    it('a thrown non-Error value is stringified into the reply_error', async () => {
      const { router, sock } = setup()
      sock.logout.mockRejectedValue('plain string failure')
      await router.handleCommand({ type: 'logout', correlationId: 'z' })
      expect(fakeParentPort.posted).toEqual([
        { type: 'reply_error', correlationId: 'z', error: 'plain string failure' }
      ])
    })

    it('an unknown command type posts nothing (no reply, no reply_error) and only warns', async () => {
      const { router } = setup()
      await router.handleCommand({ type: 'bogus', correlationId: 'u' } as unknown as WorkerCommandMessage)
      expect(fakeParentPort.posted).toEqual([])
      expect(console.warn).toHaveBeenCalled()
    })
  })
})
