import { describe, it, expect, vi } from 'vitest'
import { WAEventHandler } from '../../../services/whatsapp/WAEventHandler'
import type { IWAEventBus } from '../../../services/whatsapp/IWAEventBus'
import type { WASocket } from '../../../services/whatsapp/types'

/**
 * F-MSG-2 (R-MSG-03): a phone edit reaches us twice from Baileys: as an upsert
 * carrying a protocolMessage (-> `message:edited`) and as a messages.update echo
 * carrying `{ editedMessage }` (-> used to be re-emitted as `message:decrypted`).
 * The echo must not be processed a second time.
 */
function makeHandler(): { handler: WAEventHandler; emit: ReturnType<typeof vi.fn> } {
  const emit = vi.fn().mockResolvedValue(undefined)
  const bus = { emit } as unknown as IWAEventBus
  const handler = new WAEventHandler({} as never, {} as never, {} as never, {} as never, bus)
  return { handler, emit }
}
const sock = {} as unknown as WASocket
const key = { id: 'm1', remoteJid: '123@s.whatsapp.net', fromMe: false }
const names = (emit: ReturnType<typeof vi.fn>): string[] => emit.mock.calls.map((c) => c[0] as string)

describe('WAEventHandler messages.update edit handling', () => {
  it.fails('does not emit message:decrypted for an editedMessage echo', async () => {
    const { handler, emit } = makeHandler()
    await handler.handleMessagesUpdate(
      [{ key, update: { message: { editedMessage: { message: { conversation: 'new text' } } } } }],
      sock
    )
    expect(names(emit)).not.toContain('message:decrypted')
  })

  it('still emits message:decrypted for an ordinary decrypted payload', async () => {
    const { handler, emit } = makeHandler()
    await handler.handleMessagesUpdate([{ key, update: { message: { conversation: 'late decrypt' } } }], sock)
    expect(names(emit)).toEqual(['message:decrypted'])
  })

  it('still emits message:edited once for a protocolMessage edit update', async () => {
    const { handler, emit } = makeHandler()
    await handler.handleMessagesUpdate(
      [
        {
          key,
          update: {
            protocolMessage: { type: 'MESSAGE_EDIT', key, editedMessage: { conversation: 'new text' } }
          }
        }
      ],
      sock
    )
    expect(names(emit)).toEqual(['message:edited'])
  })
})
