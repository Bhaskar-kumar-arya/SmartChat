import { describe, it, expect, vi, beforeEach } from 'vitest'

/**
 * Pass-2 Slice 1 regression.
 *
 * P2-S1-04: the skip_sync command replied `{status:'success'}` unconditionally,
 *           even when historySyncManager.skipSync only deferred completion
 *           (chunks still ingesting). The router must surface a distinct
 *           `{status:'deferred'}` in that case.
 */

const postMessage = vi.fn()
vi.mock('worker_threads', () => ({
  parentPort: { postMessage: (...a: unknown[]) => postMessage(...a) }
}))

import { WorkerCommandRouter } from '../../../../workers/whatsapp/routing/workerCommandRouter'

function makeRouter(skipSync: ReturnType<typeof vi.fn>) {
  const connectionManager = {
    getSocket: () => ({}),
    getRepos: () => ({ historySyncManager: { skipSync } })
  } as any
  return new WorkerCommandRouter(connectionManager, vi.fn() as any)
}

function makeRouterWithSock(sock: Record<string, unknown>) {
  const connectionManager = { getSocket: () => sock, getRepos: () => ({}) } as any
  return new WorkerCommandRouter(connectionManager, vi.fn() as any)
}

/**
 * Individual-contact profile pictures: Baileys' sock.profilePictureUrl attaches a
 * stored `tctoken` to user-JID queries, and WhatsApp then never answers (30s bridge
 * timeout, avatars stay blank). The same iq WITHOUT the token answers in ~300ms
 * (verified live, PN and LID). The router must send the query itself, token-free.
 */
describe('WorkerCommandRouter — profile_picture_url sends the iq without a tctoken', () => {
  beforeEach(() => postMessage.mockClear())

  const pictureReply = (url?: string) => ({
    tag: 'iq',
    attrs: {},
    content: [{ tag: 'picture', attrs: url ? { url } : {} }]
  })

  it.fails('queries w:profile:picture with no tctoken child and replies with the url', async () => {
    const query = vi.fn().mockResolvedValue(pictureReply('https://pps.whatsapp.net/a.jpg'))
    const profilePictureUrl = vi.fn().mockResolvedValue(undefined)
    const router = makeRouterWithSock({ query, profilePictureUrl })

    await router.handleCommand({
      type: 'profile_picture_url',
      correlationId: 'p1',
      payload: { jid: '917011514625@s.whatsapp.net', type: 'preview' }
    } as any)

    expect(profilePictureUrl).not.toHaveBeenCalled()
    expect(query).toHaveBeenCalledTimes(1)
    const node = query.mock.calls[0][0]
    expect(node.attrs).toMatchObject({
      target: '917011514625@s.whatsapp.net',
      type: 'get',
      xmlns: 'w:profile:picture'
    })
    expect(node.content.map((c: any) => c.tag)).toEqual(['picture'])
    expect(node.content[0].attrs).toEqual({ type: 'preview', query: 'url' })
    expect(postMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'reply',
        correlationId: 'p1',
        payload: { result: 'https://pps.whatsapp.net/a.jpg' }
      })
    )
  })

  it('replies with an undefined result when the contact has no picture node url', async () => {
    const query = vi.fn().mockResolvedValue(pictureReply())
    const router = makeRouterWithSock({ query, profilePictureUrl: vi.fn() })

    await router.handleCommand({
      type: 'profile_picture_url',
      correlationId: 'p2',
      payload: { jid: '917011514625@s.whatsapp.net', type: 'image' }
    } as any)

    expect(postMessage).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'reply', correlationId: 'p2', payload: { result: undefined } })
    )
  })

  it.fails('forwards a server error (e.g. not-authorized) as reply_error', async () => {
    const query = vi.fn().mockRejectedValue(new Error('not-authorized'))
    const router = makeRouterWithSock({ query, profilePictureUrl: vi.fn() })

    await router.handleCommand({
      type: 'profile_picture_url',
      correlationId: 'p3',
      payload: { jid: '120363422066620600@g.us', type: 'preview' }
    } as any)

    expect(postMessage).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'reply_error', correlationId: 'p3', error: 'not-authorized' })
    )
  })
})

describe('WorkerCommandRouter — P2-S1-04 skip_sync deferred status', () => {
  beforeEach(() => postMessage.mockClear())

  it("replies {status:'success'} when skipSync completes", async () => {
    const router = makeRouter(vi.fn().mockResolvedValue('completed'))
    await router.handleCommand({ type: 'skip_sync', correlationId: 'c1', payload: {} } as any)

    expect(postMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'reply',
        correlationId: 'c1',
        payload: { result: { status: 'success' } }
      })
    )
  })

  it("replies {status:'deferred'} when skipSync defers completion", async () => {
    const router = makeRouter(vi.fn().mockResolvedValue('deferred'))
    await router.handleCommand({ type: 'skip_sync', correlationId: 'c2', payload: {} } as any)

    expect(postMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'reply',
        correlationId: 'c2',
        payload: { result: { status: 'deferred' } }
      })
    )
  })
})
