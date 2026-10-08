import { describe, it, expect, vi } from 'vitest'
import { EventEmitter } from 'events'
import type { GroupMetadata, WASocket } from '@whiskeysockets/baileys'
import { WorkerGroupCache } from '../../../../workers/whatsapp/services/WorkerGroupCache'

const G = '1@g.us'

function group(ids: string[], extra: Partial<GroupMetadata> = {}): GroupMetadata {
  return {
    id: G,
    owner: undefined,
    subject: 'Team',
    participants: ids.map((id) => ({ id })),
    ...extra
  } as GroupMetadata
}

function ids(cache: WorkerGroupCache): string[] | undefined {
  return cache.get(G)?.participants.map((p) => p.id)
}

describe('WorkerGroupCache', () => {
  it('set/get/delete/clear', () => {
    const c = new WorkerGroupCache()
    c.set(group(['a']))
    expect(ids(c)).toEqual(['a'])
    c.delete(G)
    expect(c.get(G)).toBeUndefined()
    c.setAll({ [G]: group(['a']) })
    c.clear()
    expect(c.get(G)).toBeUndefined()
  })

  it('applyUpdate merges into a cached group and ignores partials for unknown groups', () => {
    const c = new WorkerGroupCache()
    c.applyUpdate({ id: G, subject: 'Partial' })
    expect(c.get(G)).toBeUndefined()
    c.set(group(['a']))
    c.applyUpdate({ id: G, subject: 'Renamed' })
    expect(c.get(G)?.subject).toBe('Renamed')
    expect(ids(c)).toEqual(['a'])
  })

  it('applies add / remove / promote / demote participant updates', () => {
    const c = new WorkerGroupCache()
    c.set(group(['a', 'b']))
    c.applyParticipantsUpdate({ id: G, action: 'add', participants: [{ id: 'c' }, { id: 'a' }] })
    expect(ids(c)).toEqual(['a', 'b', 'c'])
    c.applyParticipantsUpdate({ id: G, action: 'remove', participants: [{ id: 'b' }] })
    expect(ids(c)).toEqual(['a', 'c'])
    c.applyParticipantsUpdate({ id: G, action: 'promote', participants: [{ id: 'a' }] })
    expect(c.get(G)?.participants[0].admin).toBe('admin')
    c.applyParticipantsUpdate({ id: G, action: 'demote', participants: [{ id: 'a' }] })
    expect(c.get(G)?.participants[0].admin).toBeNull()
  })

  it('evicts on modify so the next send refetches', () => {
    const c = new WorkerGroupCache()
    c.set(group(['a']))
    c.applyParticipantsUpdate({ id: G, action: 'modify', participants: [{ id: 'a' }] })
    expect(c.get(G)).toBeUndefined()
  })

  it('attach fills from fetches and group events', async () => {
    const ev = new EventEmitter()
    const sock = {
      ev,
      groupFetchAllParticipating: vi.fn(async () => ({ [G]: group(['a']) })),
      groupMetadata: vi.fn(async () => group(['a', 'z']))
    } as unknown as WASocket
    const c = new WorkerGroupCache()
    c.attach(sock)

    await sock.groupFetchAllParticipating()
    expect(ids(c)).toEqual(['a'])
    await sock.groupMetadata(G)
    expect(ids(c)).toEqual(['a', 'z'])

    ev.emit('group-participants.update', {
      id: G,
      author: 'x',
      action: 'remove',
      participants: [{ id: 'z' }]
    })
    expect(ids(c)).toEqual(['a'])
    ev.emit('groups.update', [{ id: G, subject: 'New' }])
    expect(c.get(G)?.subject).toBe('New')
    ev.emit('groups.upsert', [group(['q'], { id: '2@g.us' })])
    expect(c.get('2@g.us')?.participants).toHaveLength(1)
  })

  it('keeps entries when a new socket attaches to the same cache (reconnect)', () => {
    const c = new WorkerGroupCache()
    c.set(group(['a']))
    c.attach({ ev: new EventEmitter() } as unknown as WASocket)
    expect(ids(c)).toEqual(['a'])
  })
})
