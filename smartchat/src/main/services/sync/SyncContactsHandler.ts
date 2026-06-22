import { IContactMutationService } from '../contacts/IContactService'
import { cleanJid } from '../../utils/jidUtils'
export interface LidPnMapping {
  lid: string
  pn: string
}

export interface PhoneNumberToLidMapping {
  lidJid: string
  pnJid: string
}

export interface RawContact {
  id?: unknown
  lid?: unknown
  phoneNumber?: unknown
  name?: unknown
  notify?: unknown
  pushName?: unknown
  verifiedName?: unknown
  [key: string]: unknown
}

/**
 * SyncContactsHandler — Single Responsibility: process all contact-related data
 * during a history sync chunk.
 *
 * Responsibilities:
 *  1. Process LID ↔ PN mappings (both directions).
 *  2. Upsert contacts into the database.
 */
export class SyncContactsHandler {
  constructor(private readonly contactService: IContactMutationService) {}

  /**
   * Process LID ↔ PN link mappings coming in from the sync payload.
   * Handles both the `lidPnMappings` and `phoneNumberToLidMappings` arrays.
   */
  async processLidPnMappings(
    lidPnMappings: LidPnMapping[] | undefined,
    phoneNumberToLidMappings: PhoneNumberToLidMapping[] | undefined
  ): Promise<void> {
    if (lidPnMappings && lidPnMappings.length > 0) {
      let count = 0
      for (const mapping of lidPnMappings) {
        if (++count % 100 === 0) {
          await new Promise(r => setImmediate(r))
        }
        if (mapping.lid && mapping.pn) {
          await this.contactService.linkLidAndPn(mapping.lid, mapping.pn, 'history.sync').catch((err: unknown) => {
            console.error('[SyncContactsHandler] linkLidAndPn (lidPnMappings) failed:', err)
          })
        }
      }
    }

    if (phoneNumberToLidMappings && phoneNumberToLidMappings.length > 0) {
      let count = 0
      for (const mapping of phoneNumberToLidMappings) {
        if (++count % 100 === 0) {
          await new Promise(r => setImmediate(r))
        }
        if (mapping.lidJid && mapping.pnJid) {
          await this.contactService
            .linkLidAndPn(mapping.lidJid, mapping.pnJid, 'history.sync.ph')
            .catch((err: unknown) => {
              console.error('[SyncContactsHandler] linkLidAndPn (phoneNumberToLidMappings) failed:', err)
            })
        }
      }
    }
  }

  /**
   * Upsert all contacts from the sync payload into the database.
   * Skips bare LID contacts that carry no name data.
   *
   * @returns The number of contacts processed.
   */
  async processContacts(contacts: RawContact[]): Promise<number> {
    if (!contacts || contacts.length === 0) return 0

    let count = 0
    for (const c of contacts) {
      if (!c.id) continue
      if (++count % 50 === 0) {
        await new Promise(r => setImmediate(r))
      }

      const cleanedId = cleanJid(String(c.id))

      // Skip bare LID contacts with no name data
      const isBareLid =
        cleanedId.endsWith('@lid') && !c.name && !c.notify && !c.pushName && !c.verifiedName
      if (isBareLid) continue

      const toStr = (v: unknown): string | undefined =>
        v !== undefined && v !== null ? String(v) : undefined

      const contactToUpsert = {
        id: cleanedId,
        lid: c.lid ? cleanJid(String(c.lid)) : undefined,
        phoneNumber: c.phoneNumber ? cleanJid(String(c.phoneNumber)) : undefined,
        name: toStr(c.name),
        notify: toStr(c.notify),
        pushName: toStr(c.pushName),
        verifiedName: toStr(c.verifiedName)
      }

      await this.contactService.upsertContact(contactToUpsert, { overwriteName: true }).catch((err: unknown) => {
        console.error('[SyncContactsHandler] upsertContact failed:', err)
      })

      // If the contact carries both a PN id and a separate lid, link them now
      if (!cleanedId.endsWith('@lid') && c.lid) {
        await this.contactService
          .linkLidAndPn(cleanJid(String(c.lid)), cleanedId, 'history.sync.contact')
          .catch((err: unknown) => {
            console.error('[SyncContactsHandler] linkLidAndPn (contact lid) failed:', err)
          })
      }
    }

    return contacts.length
  }
}
