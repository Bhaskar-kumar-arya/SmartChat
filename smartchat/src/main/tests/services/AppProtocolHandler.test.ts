import { describe, it, expect, vi, beforeEach } from 'vitest'

// net.fetch isn't in the shared electron mock — stub it for this file.
const { netFetch } = vi.hoisted(() => ({
  netFetch: vi.fn(async () => new Response('file-bytes', { status: 200 }))
}))
vi.mock('electron', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>()
  return { ...actual, net: { fetch: netFetch } }
})
vi.mock('fs', () => ({ default: { existsSync: () => true }, existsSync: () => true }))

import { AppProtocolHandler } from '../../services/protocol/AppProtocolHandler'
import { SecureFileRegistry } from '../../services/protocol/SecureFileRegistry'

describe('AppProtocolHandler — app://local access control (audit S12-01)', () => {
  let registry: SecureFileRegistry
  let handler: AppProtocolHandler

  beforeEach(() => {
    netFetch.mockClear()
    registry = new SecureFileRegistry()
    handler = new AppProtocolHandler(registry)
  })

  it('denies app://local for a path that was never granted', async () => {
    const res = await handler.handleRequest(
      new Request('app://local/C:/Users/victim/AppData/Roaming/smartchat/dev.db')
    )
    expect(res.status).toBe(404)
    expect(netFetch).not.toHaveBeenCalled()
  })

  it('serves app://local only after the exact path is granted', async () => {
    const p = 'C:/Users/victim/Pictures/photo.png'
    registry.grantFile(p)
    const res = await handler.handleRequest(new Request('app://local/' + p))
    expect(res.status).toBe(200)
    expect(netFetch).toHaveBeenCalledOnce()
  })

  it('granting one file does not grant a sibling', async () => {
    registry.grantFile('C:/Users/victim/Pictures/photo.png')
    const res = await handler.handleRequest(
      new Request('app://local/C:/Users/victim/Pictures/secret.png')
    )
    expect(res.status).toBe(404)
  })
})

describe('SecureFileRegistry — traversal guard (audit S12-02)', () => {
  it('rejects a sibling directory sharing the base name prefix', () => {
    const reg = new SecureFileRegistry()
    reg.registerDirectory('media', '/data/media')
    expect(reg.resolvePath('media', '/../media-backup/x.png')).toBeNull()
  })

  it('allows a real child of the base directory', () => {
    const reg = new SecureFileRegistry()
    reg.registerDirectory('media', '/data/media')
    expect(reg.resolvePath('media', '/a.png')).toBe(require('path').resolve('/data/media/a.png'))
  })

  // S12-02 remaining: win32 filesystem is case-insensitive; a drive-letter or
  // path-segment case difference between the registered base and the resolved
  // path must not wrongly deny a valid path.
  it.runIf(process.platform === 'win32')('accepts a same-directory path that differs only in case (win32)', () => {
    const reg = new SecureFileRegistry()
    reg.registerDirectory('media', 'C:\\data\\media')
    // resolves to C:\data\MEDIA\a.png — same dir on win32, different case
    expect(reg.resolvePath('media', '/../MEDIA/a.png')).not.toBeNull()
  })
})
