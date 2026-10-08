import { describe, it, expect, vi } from 'vitest'
import { readFileSync } from 'fs'
import { join } from 'path'
import { registerAllIpc, trustedEvent } from './ipcHarness'

vi.mock('../../services/ai/AIToolInitializer', () => ({
  AIToolInitializer: { initializeAll: vi.fn() }
}))

// F-UC-1 (D3): the `get-messages` contract is
//   (jid, { limit?, before?, after? }) -> MessageItem[] oldest -> newest
// `before` / `after` are message ids. Both sides (preload + handler) are pinned here.

const PRELOAD_DIR = join(__dirname, '../../../preload')
const preloadSrc = readFileSync(join(PRELOAD_DIR, 'index.ts'), 'utf8')
const preloadDts = readFileSync(join(PRELOAD_DIR, 'index.d.ts'), 'utf8')

function setup(): { ipc: ReturnType<typeof registerAllIpc>; getChatMessagesPage: ReturnType<typeof vi.fn> } {
  const getChatMessagesPage = vi.fn().mockResolvedValue([{ id: 'm1' }])
  const ipc = registerAllIpc({ services: { messageQueryService: { getChatMessagesPage } }, getSock: () => null })
  return { ipc, getChatMessagesPage }
}

describe('get-messages contract (cursor pagination)', () => {
  it('preload sends (jid, options) and the typings declare the options object', () => {
    expect(preloadSrc).toMatch(/ipcRenderer\.invoke\('get-messages', jid, options\)/)
    expect(preloadDts).toMatch(/getMessages: \(jid: string, options\?: \{ limit\?: number; before\?: string; after\?: string \}\)/)
  })

  it('no options: newest page', async () => {
    const { ipc, getChatMessagesPage } = setup()
    const res = await ipc.invoke('get-messages', trustedEvent, 'a@s.whatsapp.net')
    expect(res).toEqual([{ id: 'm1' }])
    expect(getChatMessagesPage).toHaveBeenCalledWith(
      'a@s.whatsapp.net',
      { limit: undefined, before: undefined, after: undefined },
      null
    )
  })

  it('forwards limit and the before cursor', async () => {
    const { ipc, getChatMessagesPage } = setup()
    await ipc.invoke('get-messages', trustedEvent, 'j', { limit: 25, before: 'm50' })
    expect(getChatMessagesPage).toHaveBeenCalledWith('j', { limit: 25, before: 'm50', after: undefined }, null)
  })

  it('forwards the after cursor', async () => {
    const { ipc, getChatMessagesPage } = setup()
    await ipc.invoke('get-messages', trustedEvent, 'j', { after: 'm90' })
    expect(getChatMessagesPage).toHaveBeenCalledWith('j', { limit: undefined, before: undefined, after: 'm90' }, null)
  })

  it('rejects before + after together', async () => {
    const { ipc, getChatMessagesPage } = setup()
    await expect(ipc.invoke('get-messages', trustedEvent, 'j', { before: 'a', after: 'b' })).rejects.toThrow(
      /either before or after/
    )
    expect(getChatMessagesPage).not.toHaveBeenCalled()
  })

  it('ignores a non-string cursor and a non-numeric limit', async () => {
    const { ipc, getChatMessagesPage } = setup()
    await ipc.invoke('get-messages', trustedEvent, 'j', { before: 5, limit: '10' })
    expect(getChatMessagesPage).toHaveBeenCalledWith('j', { limit: undefined, before: undefined, after: undefined }, null)
  })
})
