/**
 * H-03: characterization of the local Baileys (rc13) patches.
 *
 * The patches are applied at install time by patch-package (see patches/). These tests
 * fail if a patch is missing/unapplied in the installed node_modules.
 */
import { describe, it, expect, vi } from 'vitest'
import fs from 'fs'
import path from 'path'
import { createRequire } from 'module'
import { pathToFileURL } from 'url'

const req = createRequire(path.join(process.cwd(), 'package.json'))
const baileysRoot = path.dirname(req.resolve('@whiskeysockets/baileys/package.json'))
const lib = (...p: string[]): string => path.join(baileysRoot, 'lib', ...p)

describe('Baileys local patches', () => {
  it('is pinned to the rc13 line the patches were written for', () => {
    const pkg = JSON.parse(fs.readFileSync(path.join(baileysRoot, 'package.json'), 'utf8'))
    expect(pkg.version).toBe('7.0.0-rc13')
  })

  it('chat-utils.processSyncAction emits app-state.sync with the raw sync action', async () => {
    const mod = await import(/* @vite-ignore */ pathToFileURL(lib('Utils', 'chat-utils.js')).href)
    const emit = vi.fn()
    const syncAction = {
      index: ['mute', 'chat@s.whatsapp.net'],
      syncAction: { value: { muteAction: { muted: true, muteEndTimestamp: 123 } } }
    }
    mod.processSyncAction(syncAction, { emit }, { id: 'me@s.whatsapp.net' }, undefined, undefined)
    expect(emit).toHaveBeenCalledWith('app-state.sync', syncAction)
    // upstream behaviour is preserved
    expect(emit).toHaveBeenCalledWith('chats.update', expect.any(Array))
  })

  it('decode-wa-message preserves messageContextInfo across deviceSentMessage unwrapping', () => {
    const src = fs.readFileSync(lib('Utils', 'decode-wa-message.js'), 'utf8')
    expect(src).toContain('const messageContextInfo = msg.messageContextInfo;')
    expect(src).toContain('msg.messageContextInfo = messageContextInfo;')
  })

  it('leaves upstream profilePictureUrl and tried-remove handling untouched (retired patches)', () => {
    const chats = fs.readFileSync(lib('Socket', 'chats.js'), 'utf8')
    expect(chats).not.toContain('NEST the tctoken here as a child')
    const cu = fs.readFileSync(lib('Utils', 'chat-utils.js'), 'utf8')
    expect(cu).not.toContain('[BaileysPatcher]')
  })
})
