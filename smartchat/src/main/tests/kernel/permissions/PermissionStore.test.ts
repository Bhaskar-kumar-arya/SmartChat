import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { PermissionStore } from '../../../kernel/permissions/PermissionStore'
import { join } from 'path'
import { existsSync, unlinkSync, writeFileSync, readdirSync } from 'fs'
import { dirname, basename } from 'path'

describe('PermissionStore', () => {
  const testStoragePath = join(__dirname, '../../../../tmp-test-permissions.json')

  const cleanup = () => {
    if (existsSync(testStoragePath)) {
      try {
        unlinkSync(testStoragePath)
      } catch {}
    }
    // Remove any .corrupt-* / .tmp siblings a test produced.
    try {
      const dir = dirname(testStoragePath)
      const stem = basename(testStoragePath)
      for (const f of readdirSync(dir)) {
        if (f.startsWith(stem) && f !== stem) {
          try { unlinkSync(join(dir, f)) } catch {}
        }
      }
    } catch {}
  }

  beforeEach(() => {
    cleanup()
  })

  afterEach(() => {
    cleanup()
  })

  it('plugin with capability in manifest: hasCapability() returns true', () => {
    const store = new PermissionStore(testStoragePath)
    store.registerPluginManifest('plugin-a', ['messages:read', 'messages:send'])

    expect(store.hasCapability('plugin-a', 'messages:read')).toBe(true)
    expect(store.hasCapability('plugin-a', 'messages:send')).toBe(true)
  })

  it('plugin without capability in manifest: hasCapability() returns false', () => {
    const store = new PermissionStore(testStoragePath)
    store.registerPluginManifest('plugin-a', ['messages:read'])

    expect(store.hasCapability('plugin-a', 'messages:send')).toBe(false)
    expect(store.hasCapability('plugin-a', 'chats:read')).toBe(false)
  })

  it('hasCapability() returns false after setCapability(false)', async () => {
    const store = new PermissionStore(testStoragePath)
    store.registerPluginManifest('plugin-a', ['messages:send'])

    expect(store.hasCapability('plugin-a', 'messages:send')).toBe(true)

    await store.setCapability('plugin-a', 'messages:send', false)

    expect(store.hasCapability('plugin-a', 'messages:send')).toBe(false)
  })

  it('isResourceAllowed() returns true with no scope configured (default-allow)', () => {
    const store = new PermissionStore(testStoragePath)

    expect(store.isResourceAllowed('plugin-a', 'chats:read', '12345@s.whatsapp.net')).toBe(true)
  })

  it('isResourceAllowed() returns true when resourceId is in allow list', async () => {
    const store = new PermissionStore(testStoragePath)
    await store.setScope('plugin-a', 'chats:read', { allow: ['12345@s.whatsapp.net', '67890@s.whatsapp.net'] })

    expect(store.isResourceAllowed('plugin-a', 'chats:read', '12345@s.whatsapp.net')).toBe(true)
  })

  it('isResourceAllowed() returns false when resourceId is NOT in allow list (allow list present)', async () => {
    const store = new PermissionStore(testStoragePath)
    await store.setScope('plugin-a', 'chats:read', { allow: ['12345@s.whatsapp.net'] })

    expect(store.isResourceAllowed('plugin-a', 'chats:read', '99999@s.whatsapp.net')).toBe(false)
  })

  it('isResourceAllowed() returns false when resourceId is in deny list', async () => {
    const store = new PermissionStore(testStoragePath)
    await store.setScope('plugin-a', 'chats:read', { deny: ['secret-group@g.us'] })

    expect(store.isResourceAllowed('plugin-a', 'chats:read', 'normal-group@g.us')).toBe(true)
    expect(store.isResourceAllowed('plugin-a', 'chats:read', 'secret-group@g.us')).toBe(false)
  })

  it('S8-05: a corrupt permissions file throws (fail-closed) and is backed up, not reset to allow-all', () => {
    writeFileSync(testStoragePath, '{ this is not json', 'utf-8')

    expect(() => new PermissionStore(testStoragePath)).toThrow(/corrupt/i)

    const dir = dirname(testStoragePath)
    const stem = basename(testStoragePath)
    const backups = readdirSync(dir).filter((f) => f.startsWith(`${stem}.corrupt-`))
    expect(backups.length).toBeGreaterThan(0)
  })

  it('S8-05: a well-formed-JSON-but-wrong-shape file also fails closed', () => {
    writeFileSync(testStoragePath, '[]', 'utf-8')
    expect(() => new PermissionStore(testStoragePath)).toThrow(/shape/i)
  })

  it('S8-05: saveToDisk leaves no .tmp file behind (atomic rename)', async () => {
    const store = new PermissionStore(testStoragePath)
    store.registerPluginManifest('plugin-a', ['messages:send'])
    await store.setCapability('plugin-a', 'messages:send', false)

    expect(existsSync(testStoragePath)).toBe(true)
    expect(existsSync(`${testStoragePath}.tmp`)).toBe(false)
  })

  it('getPluginPermissions() reflects persisted state after setCapability', async () => {
    const store = new PermissionStore(testStoragePath)
    store.registerPluginManifest('plugin-a', ['messages:send', 'chats:read'])

    await store.setCapability('plugin-a', 'messages:send', false)
    await store.setScope('plugin-a', 'chats:read', { allow: ['allowed-jid'] })

    const state = store.getPluginPermissions('plugin-a')
    expect(state.pluginId).toBe('plugin-a')
    expect(state.capabilities['messages:send']).toEqual({ granted: false })
    expect(state.capabilities['chats:read']).toEqual({
      granted: true,
      scope: { allow: ['allowed-jid'] }
    })

    // Verify persistence across new instance
    const store2 = new PermissionStore(testStoragePath)
    store2.registerPluginManifest('plugin-a', ['messages:send', 'chats:read'])
    const state2 = store2.getPluginPermissions('plugin-a')
    expect(state2.capabilities['messages:send']).toEqual({ granted: false })
    expect(state2.capabilities['chats:read']).toEqual({
      granted: true,
      scope: { allow: ['allowed-jid'] }
    })
  })
})
