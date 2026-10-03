import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

vi.mock('worker_threads', async () =>
  (await import('../../helpers/waFakes')).createWorkerThreadsModule()
)

import { WAWorkerBridge } from '../../../workers/bridge/WAWorkerBridge'
import type { WorkerCommandMessage } from '../../../workers/whatsapp/whatsappWorker.types'
import {
  FakeWorker,
  createFakeEventBus,
  createFakeWindowEmitter,
  flushPromises,
  type FakeEventBus,
  type FakeWindowEmitter
} from '../../helpers/waFakes'

/**
 * N-02 / R-WA-01: pins the main-side half of the worker<->main contract
 * (WAWorkerBridge): command names + payload shapes it posts, how it correlates
 * replies, which domain events it forwards where, and its lifecycle.
 */

describe('WAWorkerBridge contract (N-02)', () => {
  let bus: FakeEventBus
  let windowEmitter: FakeWindowEmitter
  let bridge: WAWorkerBridge
  let worker: FakeWorker

  beforeEach(() => {
    FakeWorker.reset()
    bus = createFakeEventBus()
    windowEmitter = createFakeWindowEmitter()
    bridge = new WAWorkerBridge('/w.js', '/db', '/ud', () => bus, windowEmitter)
    vi.spyOn(console, 'log').mockImplementation(() => undefined)
    vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
  })
  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  function started(): FakeWorker {
    bridge.start(true, false)
    worker = FakeWorker.last
    return worker
  }

  describe('init handshake', () => {
    it('spawns the worker at workerPath and posts an init command with the documented shape', () => {
      started()
      expect(worker.workerPath).toBe('/w.js')
      expect(worker.postMessage).toHaveBeenCalledTimes(1)
      expect(worker.commands[0]).toEqual({
        type: 'init',
        correlationId: 'init-call',
        payload: { dbPath: '/db', userDataPath: '/ud', syncFullHistory: true, shouldSyncHistory: false }
      })
    })

    it('start() while already running warns and does not spawn a second worker', () => {
      started()
      bridge.start(true, true)
      expect(FakeWorker.instances).toHaveLength(1)
      expect(bridge.isRunning()).toBe(true)
    })

    it('the init reply is not tracked: a reply for "init-call" is silently ignored', () => {
      started()
      expect(() => worker.reply('init-call', { status: 'initialized' })).not.toThrow()
    })

    // B-WA-04
    it('init failure (reply_error init-call) is silently dropped: no window event, no supervisor call', () => {
      const onExit = vi.fn()
      bridge.setUnexpectedExitHandler(onExit)
      started()
      worker.replyError('init-call', 'SQLITE_BUSY')
      expect(onExit).not.toHaveBeenCalled()
      expect(windowEmitter.send).not.toHaveBeenCalled()
      expect(bridge.isRunning()).toBe(true)
    })

    // B-WA-04
    it.fails('init failure should be treated as worker death (supervisor invoked) [B-WA-04]', () => {
      const onExit = vi.fn()
      bridge.setUnexpectedExitHandler(onExit)
      started()
      worker.replyError('init-call', 'SQLITE_BUSY')
      expect(onExit).toHaveBeenCalled()
    })
  })

  describe('commands posted to the worker (type + payload shape)', () => {
    async function cmd<T extends WorkerCommandMessage['type']>(
      type: T,
      call: () => Promise<unknown>,
      result: unknown = { status: 'success' }
    ): Promise<Extract<WorkerCommandMessage, { type: T }>> {
      started()
      const p = call()
      const posted = worker.commandOfType(type)
      expect(typeof posted.correlationId).toBe('string')
      expect(posted.correlationId).toMatch(/^cmd-\d+-/)
      worker.reply(posted.correlationId, result)
      await p
      return posted
    }

    it('sendMessage -> send_message {jid, content, options}', async () => {
      const posted = await cmd('send_message', () => bridge.sendMessage('j', { text: 'x' }, { quoted: 1 }))
      expect(posted.payload).toEqual({ jid: 'j', content: { text: 'x' }, options: { quoted: 1 } })
    })

    it('sendMessage resolves with the raw result', async () => {
      started()
      const p = bridge.sendMessage('j', { text: 'x' })
      worker.reply(worker.commandOfType('send_message').correlationId, { key: { id: 'K' } })
      await expect(p).resolves.toEqual({ key: { id: 'K' } })
    })

    it('readMessages -> read_messages {keys}, resolves void', async () => {
      started()
      const p = bridge.readMessages([{ id: '1' }])
      const posted = worker.commandOfType('read_messages')
      expect(posted.payload).toEqual({ keys: [{ id: '1' }] })
      worker.reply(posted.correlationId, { status: 'success' })
      await expect(p).resolves.toBeUndefined()
    })

    it('chatModify(modification, jid) -> chat_modify {jid, modification}', async () => {
      const posted = await cmd('chat_modify', () => bridge.chatModify({ archive: true }, 'j'))
      expect(posted.payload).toEqual({ jid: 'j', modification: { archive: true } })
    })

    it('groupFetchAllParticipating -> group_fetch_all with no payload', async () => {
      const posted = await cmd('group_fetch_all', () => bridge.groupFetchAllParticipating(), { groups: {} })
      expect(posted.payload).toBeUndefined()
    })

    it('groupMetadata -> group_metadata {jid}', async () => {
      const posted = await cmd('group_metadata', () => bridge.groupMetadata('g@g.us'), { id: 'g@g.us' })
      expect(posted.payload).toEqual({ jid: 'g@g.us' })
    })

    it('logout -> logout with no payload, resolves void', async () => {
      started()
      const p = bridge.logout()
      const posted = worker.commandOfType('logout')
      expect(posted.payload).toBeUndefined()
      worker.reply(posted.correlationId, { status: 'success' })
      await expect(p).resolves.toBeUndefined()
    })

    it('skipSync -> skip_sync with no payload', async () => {
      const posted = await cmd('skip_sync', () => bridge.skipSync())
      expect(posted.payload).toBeUndefined()
    })

    it('fetchMessageHistory -> fetch_message_history with the payload passed through unchanged', async () => {
      const payload = { count: 10, jid: 'j', oldestMsgId: 'M', oldestMsgFromMe: false, oldestMsgTimestampMs: 5 }
      started()
      const p = bridge.fetchMessageHistory(payload)
      const posted = worker.commandOfType('fetch_message_history')
      expect(posted.payload).toEqual(payload)
      worker.reply(posted.correlationId, { requestId: 'R' })
      await expect(p).resolves.toEqual({ requestId: 'R' })
    })

    it('updateMediaMessage -> update_media_message {msg}', async () => {
      const posted = await cmd('update_media_message', () => bridge.updateMediaMessage({ k: 1 }), { k: 2 })
      expect(posted.payload).toEqual({ msg: { k: 1 } })
    })

    it('profilePictureUrl -> profile_picture_url {jid, type}', async () => {
      const posted = await cmd('profile_picture_url', () => bridge.profilePictureUrl('j', 'preview'), 'u')
      expect(posted.payload).toEqual({ jid: 'j', type: 'preview' })
    })

    it('signalRepository.lidMapping.getPNForLID -> get_pn_for_lid {lid}', async () => {
      const posted = await cmd(
        'get_pn_for_lid',
        () => bridge.signalRepository.lidMapping.getPNForLID('x@lid'),
        'pn@s.whatsapp.net'
      )
      expect(posted.payload).toEqual({ lid: 'x@lid' })
    })

    it('every bridge method uses a command name that exists in WorkerCommandMessage', async () => {
      started()
      const calls: Array<() => Promise<unknown>> = [
        () => bridge.sendMessage('j', {}),
        () => bridge.readMessages([]),
        () => bridge.chatModify({}, 'j'),
        () => bridge.groupFetchAllParticipating(),
        () => bridge.groupMetadata('j'),
        () => bridge.logout(),
        () => bridge.skipSync(),
        () =>
          bridge.fetchMessageHistory({
            count: 1,
            jid: 'j',
            oldestMsgId: 'm',
            oldestMsgFromMe: false,
            oldestMsgTimestampMs: 1
          }),
        () => bridge.updateMediaMessage({}),
        () => bridge.profilePictureUrl('j', 'image'),
        () => bridge.signalRepository.lidMapping.getPNForLID('l')
      ]
      const pending = calls.map((c) => c())
      const types = worker.commands.slice(1).map((c) => c.type)
      expect(types).toEqual([
        'send_message',
        'read_messages',
        'chat_modify',
        'group_fetch_all',
        'group_metadata',
        'logout',
        'skip_sync',
        'fetch_message_history',
        'update_media_message',
        'profile_picture_url',
        'get_pn_for_lid'
      ])
      for (const c of worker.commands.slice(1)) worker.reply(c.correlationId, null)
      await Promise.all(pending)
    })

    it('correlation ids are unique per command', () => {
      started()
      void bridge.groupMetadata('a').catch(() => undefined)
      void bridge.groupMetadata('b').catch(() => undefined)
      const ids = worker.commands.slice(1).map((c) => c.correlationId)
      expect(new Set(ids).size).toBe(2)
    })

    it('sendCommand before start rejects with "Worker thread is not running"', async () => {
      await expect(bridge.sendMessage('j', {})).rejects.toThrow('Worker thread is not running')
    })
  })

  describe('reply correlation', () => {
    it('reply resolves only the matching pending command; reply_error rejects it with an Error(error)', async () => {
      started()
      const a = bridge.groupMetadata('a')
      const b = bridge.groupMetadata('b')
      const [ca, cb] = worker.commands.slice(1).map((c) => c.correlationId)
      worker.replyError(cb, 'nope')
      worker.reply(ca, { id: 'a' })
      await expect(a).resolves.toEqual({ id: 'a' })
      await expect(b).rejects.toThrow('nope')
    })

    it('a reply with an unknown correlationId is ignored', () => {
      started()
      expect(() => worker.reply('cmd-999', 1)).not.toThrow()
      expect(() => worker.replyError('cmd-999', 'x')).not.toThrow()
    })

    it('non-object / null worker messages are ignored', () => {
      started()
      expect(() => {
        worker._emitMessage(null)
        worker._emitMessage('str')
        worker._emitMessage(42)
      }).not.toThrow()
      expect(windowEmitter.send).not.toHaveBeenCalled()
      expect(bus.emit).not.toHaveBeenCalled()
    })

    it('rejects after 30s when the worker never replies', async () => {
      vi.useFakeTimers()
      started()
      const settled = bridge.groupMetadata('j').then(
        () => 'ok',
        (e: Error) => e.message
      )
      await vi.advanceTimersByTimeAsync(30_000)
      expect(await settled).toMatch(/Command "group_metadata" timed out after 30000ms/)
    })
  })

  describe('domain_event forwarding', () => {
    const windowForwarded = [
      'wa-qr',
      'wa-logged-out',
      'wa-session-replaced',
      'wa-connected',
      'wa-sync-progress',
      'wa-sync-status',
      'wa-sync-complete',
      'wa-history-appended'
    ]

    it.each(windowForwarded)('%s is sent to the renderer window AND emitted on the bus with the raw payload', async (name) => {
      started()
      worker.domainEvent(name, { a: 1 })
      await flushPromises()
      expect(windowEmitter.send).toHaveBeenCalledWith(name, { a: 1 })
      expect(bus.emit).toHaveBeenCalledWith(name, { a: 1 })
    })

    it('forwarding list is exactly the 8 wa-* events (anything else never reaches the window)', async () => {
      started()
      for (const name of ['connection.update', 'chats.upsert', 'wa-disconnected', 'wa-me', 'wa-other']) {
        worker.domainEvent(name, { a: 1 })
      }
      await flushPromises()
      expect(windowEmitter.send).not.toHaveBeenCalled()
    })

    it('non-window events are still emitted on the bus', async () => {
      started()
      worker.domainEvent('chats.upsert', { chats: [] })
      await flushPromises()
      expect(bus.emit).toHaveBeenCalledWith('chats.upsert', { chats: [] })
    })

    const sockInjected = [
      'message:incoming',
      'messages:append',
      'message:edited',
      'message:decrypted',
      'presence:update',
      'receipt:update',
      'reaction:update'
    ]

    it.each(sockInjected)('%s: bus payload gets { ...data, sock: bridge } injected', async (name) => {
      started()
      worker.domainEvent(name, { id: 'x' })
      await flushPromises()
      expect(bus.emit).toHaveBeenCalledWith(name, { id: 'x', sock: bridge })
    })

    it('sock injection does not apply to other events or to non-object payloads', async () => {
      started()
      worker.domainEvent('message:incoming', 'scalar')
      worker.domainEvent('chat:upsert', { id: 1 })
      await flushPromises()
      expect(bus.emit).toHaveBeenNthCalledWith(1, 'message:incoming', 'scalar')
      expect(bus.emit).toHaveBeenNthCalledWith(2, 'chat:upsert', { id: 1 })
    })

    it('without a bus, window events still forward and nothing throws', () => {
      const b = new WAWorkerBridge('/w.js', '/db', '/ud', () => null, windowEmitter)
      b.start(true, true)
      FakeWorker.last.domainEvent('wa-qr', 'q')
      expect(windowEmitter.send).toHaveBeenCalledWith('wa-qr', 'q')
    })

    it('a rejecting bus.emit is logged and does not break the ordered emit chain', async () => {
      bus.emit.mockRejectedValueOnce(new Error('handler blew up')).mockResolvedValue(undefined)
      started()
      worker.domainEvent('chats.upsert', 1)
      worker.domainEvent('chats.update', 2)
      await flushPromises()
      expect(bus.emit).toHaveBeenCalledTimes(2)
      expect(console.error).toHaveBeenCalled()
    })
  })

  describe('self identity (bridge.user)', () => {
    it('is null before any event', () => {
      started()
      expect(bridge.user).toBeNull()
    })

    it('is populated from a connection.update that carries creds.me (shape Baileys never produces)', () => {
      started()
      worker.domainEvent('connection.update', { creds: { me: { id: '1@s.whatsapp.net', name: 'N', lid: 'L@lid' } } })
      expect(bridge.user).toEqual({ id: '1@s.whatsapp.net', name: 'N', lid: 'L@lid' })
    })

    it('falsy name/lid collapse to null', () => {
      started()
      worker.domainEvent('connection.update', { creds: { me: { id: '1@s.whatsapp.net', name: '' } } })
      expect(bridge.user).toEqual({ id: '1@s.whatsapp.net', name: null, lid: null })
    })

    // B-WA-01
    it('a realistic connection.update ({connection:"open"}, no creds) leaves user null (B-WA-01 pinned)', () => {
      started()
      worker.domainEvent('connection.update', { connection: 'open', isNewLogin: false, receivedPendingNotifications: true })
      expect(bridge.user).toBeNull()
    })

    // B-WA-01
    it.fails('user should be set from a worker-published wa-me {id,name,lid} event [B-WA-01]', () => {
      started()
      worker.domainEvent('wa-me', { id: '1@s.whatsapp.net', name: 'N', lid: 'L@lid' })
      expect(bridge.user).toEqual({ id: '1@s.whatsapp.net', name: 'N', lid: 'L@lid' })
    })

    it('is cleared on worker exit and on stop()', async () => {
      started()
      worker.domainEvent('connection.update', { creds: { me: { id: 'a' } } })
      worker._triggerExit(0)
      expect(bridge.user).toBeNull()

      bridge.start(true, true)
      FakeWorker.last.domainEvent('connection.update', { creds: { me: { id: 'a' } } })
      expect(bridge.user).not.toBeNull()
      const stopped = bridge.stop()
      FakeWorker.last.reply(FakeWorker.last.commandOfType('shutdown').correlationId, { status: 'success' })
      await stopped
      expect(bridge.user).toBeNull()
    })
  })

  describe('lifecycle', () => {
    it('stop() sends a shutdown command, awaits the ack, then terminates (B-WA-09 fixed by F-WA-3)', async () => {
      started()
      const stopped = bridge.stop()
      worker.reply(worker.commandOfType('shutdown').correlationId, { status: 'success' })
      await stopped
      expect(worker.terminate).toHaveBeenCalledTimes(1)
      expect(worker.commands.map((c) => c.type)).toEqual(['init', 'shutdown'])
      expect(bridge.isRunning()).toBe(false)
    })

    it('stop() with no worker is a no-op', async () => {
      await expect(bridge.stop()).resolves.toBeUndefined()
    })

    it('exit rejects all pending commands with "Worker exited with code N before replying"', async () => {
      started()
      const p = bridge.groupMetadata('j')
      worker._triggerExit(7)
      await expect(p).rejects.toThrow('Worker exited with code 7 before replying')
      expect(bridge.isRunning()).toBe(false)
    })

    it('unexpected non-zero exit: sends wa-disconnected {code} to the window and calls the supervisor', () => {
      const onExit = vi.fn()
      bridge.setUnexpectedExitHandler(onExit)
      started()
      worker._triggerExit(3)
      expect(windowEmitter.send).toHaveBeenCalledWith('wa-disconnected', { code: 3 })
      expect(onExit).toHaveBeenCalledWith(3)
    })

    it('exit code 0 is not treated as unexpected', () => {
      const onExit = vi.fn()
      bridge.setUnexpectedExitHandler(onExit)
      started()
      worker._triggerExit(0)
      expect(onExit).not.toHaveBeenCalled()
      expect(windowEmitter.send).not.toHaveBeenCalled()
    })

    it('a throwing supervisor or window emitter does not propagate out of the exit handler', () => {
      windowEmitter.send.mockImplementation(() => {
        throw new Error('window gone')
      })
      bridge.setUnexpectedExitHandler(() => {
        throw new Error('supervisor bug')
      })
      started()
      expect(() => worker._triggerExit(1)).not.toThrow()
    })

    it('worker "error" events are only logged', () => {
      started()
      expect(() => worker._triggerError(new Error('x'))).not.toThrow()
      expect(console.error).toHaveBeenCalled()
      expect(bridge.isRunning()).toBe(true)
    })

    it('can be restarted after an exit (new Worker, fresh init)', () => {
      started()
      worker._triggerExit(1)
      bridge.start(false, true)
      expect(FakeWorker.instances).toHaveLength(2)
      expect(FakeWorker.last.commands[0]).toMatchObject({
        type: 'init',
        payload: { syncFullHistory: false, shouldSyncHistory: true }
      })
    })
  })

  describe('reply shapes the bridge hands to callers (worker reply vs bridge typing)', () => {
    // B-WA-13
    it('skipSync discards the worker {status} reply (resolves undefined) (B-WA-13 pinned)', async () => {
      started()
      const p = bridge.skipSync()
      worker.reply(worker.commandOfType('skip_sync').correlationId, { status: 'deferred' })
      await expect(p).resolves.toBeUndefined()
    })

    // B-WA-13
    it.fails("skipSync should surface the worker's {status:'deferred'} reply [B-WA-13]", async () => {
      started()
      const p = bridge.skipSync()
      worker.reply(worker.commandOfType('skip_sync').correlationId, { status: 'deferred' })
      await expect(p).resolves.toEqual({ status: 'deferred' })
    })

    // B-WA-15
    it('groupFetchAllParticipating returns the worker reply as-is, i.e. {groups: {...}} (B-WA-15 pinned)', async () => {
      started()
      const p = bridge.groupFetchAllParticipating()
      worker.reply(worker.commandOfType('group_fetch_all').correlationId, { groups: { 'g@g.us': { id: 'g@g.us' } } })
      await expect(p).resolves.toEqual({ groups: { 'g@g.us': { id: 'g@g.us' } } })
    })

    // B-WA-15
    it.fails('groupFetchAllParticipating should return Record<jid, GroupMetadata> as typed [B-WA-15]', async () => {
      started()
      const p = bridge.groupFetchAllParticipating()
      worker.reply(worker.commandOfType('group_fetch_all').correlationId, { groups: { 'g@g.us': { id: 'g@g.us' } } })
      await expect(p).resolves.toEqual({ 'g@g.us': { id: 'g@g.us' } })
    })
  })
})
