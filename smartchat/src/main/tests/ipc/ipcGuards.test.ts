import { describe, it, expect, afterEach, vi } from 'vitest'
import { resolve, sep } from 'path'
import { resolveInsideDir, isTrustedSender } from '../../ipc/ipcGuards'

describe('resolveInsideDir (S10-04)', () => {
  const base = resolve('smartchat-test-temp')

  it('keeps a plain file name inside the base dir', () => {
    expect(resolveInsideDir(base, 'voice_1.ogg')).toBe(base + sep + 'voice_1.ogg')
  })

  it('neutralizes a directory component down to the basename (stays in base)', () => {
    expect(resolveInsideDir(base, 'sub/dir/x.bin')).toBe(base + sep + 'x.bin')
  })

  it('neutralizes parent-traversal names (result never escapes base)', () => {
    for (const name of ['../../dev.db', '..\\..\\dev.db']) {
      const out = resolveInsideDir(base, name)
      expect(out.startsWith(base + sep)).toBe(true)
      expect(out.includes('..')).toBe(false)
    }
  })

  it('rejects empty / dot names', () => {
    expect(() => resolveInsideDir(base, '')).toThrow()
    expect(() => resolveInsideDir(base, '..')).toThrow()
  })
})

describe('isTrustedSender (S10-05/S10-06)', () => {
  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it('accepts the top-level prod renderer frame', () => {
    vi.stubEnv('ELECTRON_RENDERER_URL', '')
    expect(isTrustedSender({ senderFrame: { parent: null, url: 'file:///C:/app/renderer/index.html' } })).toBe(true)
  })

  it('accepts the dev renderer frame', () => {
    vi.stubEnv('ELECTRON_RENDERER_URL', 'http://localhost:5173')
    expect(isTrustedSender({ senderFrame: { parent: null, url: 'http://localhost:5173/' } })).toBe(true)
  })

  it('rejects a sub-frame', () => {
    expect(isTrustedSender({ senderFrame: { parent: {}, url: 'file:///C:/app/renderer/index.html' } })).toBe(false)
  })

  it('rejects a <webview> guest page on an arbitrary origin', () => {
    expect(isTrustedSender({ senderFrame: { parent: null, url: 'https://evil.example/' } })).toBe(false)
  })

  it('rejects a missing frame', () => {
    expect(isTrustedSender({ senderFrame: null })).toBe(false)
    expect(isTrustedSender({})).toBe(false)
  })

  it('accepts the prod renderer frame with a hash route / query string (S10-06)', () => {
    vi.stubEnv('ELECTRON_RENDERER_URL', '')
    expect(isTrustedSender({ senderFrame: { parent: null, url: 'file:///C:/app/renderer/index.html#/chats' } })).toBe(true)
    expect(isTrustedSender({ senderFrame: { parent: null, url: 'file:///C:/app/renderer/index.html?foo=1' } })).toBe(true)
  })

  it('still rejects a file:// document that only ends with the renderer path in its query', () => {
    vi.stubEnv('ELECTRON_RENDERER_URL', '')
    expect(isTrustedSender({ senderFrame: { parent: null, url: 'file:///tmp/evil.html?x=/renderer/index.html' } })).toBe(false)
  })
})
