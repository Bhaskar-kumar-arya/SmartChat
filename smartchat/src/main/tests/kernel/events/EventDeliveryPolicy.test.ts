import { describe, it, expect, vi } from 'vitest'
import { EventDeliveryPolicy } from '../../../kernel/events/EventDeliveryPolicy'
import { IPermissionStore } from '../../../kernel/permissions/IPermissionStore'

function perms(over: Partial<Record<keyof IPermissionStore, unknown>> = {}): IPermissionStore {
  return {
    hasCapability: vi.fn().mockReturnValue(true),
    isResourceAllowed: vi.fn().mockReturnValue(true),
    ...over
  } as unknown as IPermissionStore
}

describe('EventDeliveryPolicy', () => {
  it('resolveAuthKey prefers the specific key, falls back to events:*, else null', () => {
    const wildcardOnly = new EventDeliveryPolicy(
      perms({ hasCapability: vi.fn((_id: string, cap: string) => cap === 'events:*') })
    )
    expect(wildcardOnly.resolveAuthKey('a', 'chat:update')).toBe('events:*')
    expect(new EventDeliveryPolicy(perms()).resolveAuthKey('a', 'chat:update')).toBe('events:chat:update')
    const denied = new EventDeliveryPolicy(perms({ hasCapability: vi.fn().mockReturnValue(false) }))
    expect(denied.resolveAuthKey('a', 'x')).toBeNull()
  })

  it('without a permission store nothing is gated but payloads are sanitised', () => {
    const d = new EventDeliveryPolicy().decide('a', 'message:incoming', 'events:*', {
      chatJid: 'x@s',
      sock: {},
      n: BigInt(1)
    })
    expect(d).toEqual({ deliver: true, payload: { chatJid: 'x@s', n: '1' } })
  })

  it('re-checks the authorising capability at delivery time', () => {
    const hasCapability = vi.fn().mockReturnValue(false)
    const d = new EventDeliveryPolicy(perms({ hasCapability })).decide('a', 'message:incoming', 'events:*', {})
    expect(d).toEqual({ deliver: false })
    expect(hasCapability).toHaveBeenCalledWith('a', 'events:*')
  })

  it('filters messages:append per element and drops when none remain', () => {
    const p = new EventDeliveryPolicy(
      perms({ isResourceAllowed: vi.fn((_a: string, _c: string, jid: string) => jid === 'ok@s') })
    )
    const msgs = [{ key: { remoteJid: 'ok@s' } }, { key: { remoteJid: 'no@s' } }]
    expect(p.decide('a', 'messages:append', 'events:*', { messages: msgs })).toEqual({
      deliver: true,
      payload: { messages: [msgs[0]] }
    })
    expect(p.decide('a', 'messages:append', 'events:*', { messages: [msgs[1]] })).toEqual({ deliver: false })
  })
})
