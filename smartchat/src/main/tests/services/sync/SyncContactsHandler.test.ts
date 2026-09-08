import { describe, it, expect, vi, beforeEach } from 'vitest'
import { SyncContactsHandler } from '../../../services/sync/SyncContactsHandler'

/**
 * P2-S4-03: processContacts must report the number of contacts actually upserted,
 * not the raw payload length — id-less and bare-LID entries are skipped.
 */
describe('SyncContactsHandler (S4-03 processed count)', () => {
  let contactService: any
  let handler: SyncContactsHandler

  beforeEach(() => {
    contactService = {
      upsertContact: vi.fn().mockResolvedValue(undefined),
      linkLidAndPn: vi.fn().mockResolvedValue(undefined)
    }
    handler = new SyncContactsHandler(contactService)
  })

  it('does not count id-less or bare-LID entries', async () => {
    const contacts = [
      { id: '111@s.whatsapp.net', name: 'Real One' },
      { }, // id-less → skipped
      { id: '999@lid' }, // bare LID, no name data → skipped
      { id: '222@s.whatsapp.net', notify: 'Two' }
    ] as any

    const processed = await handler.processContacts(contacts)

    expect(processed).toBe(2)
    expect(contactService.upsertContact).toHaveBeenCalledTimes(2)
  })
})
