/**
 * ContactGroupSubscriber
 * ======================
 * Listens to contact and group domain events and delegates to the appropriate
 * services for persistence.
 *
 * Single responsibility: contact/group data management only.
 */


import type { IWAEventBus } from '../IWAEventBus'
import type { IWAEventSubscriber } from './IWAEventSubscriber'
import type {
  ContactUpsertedEvent,
  ContactUpdatedEvent,
  LidMappingEvent,
  GroupUpdatedEvent,
  GroupParticipantsEvent,
} from '../WAEventTypes'
import type { IContactService } from '../../contacts/IContactService'
import type { IChatService } from '../../chats/IChatService'
import type { IGroupMembershipService } from '../../chats/IGroupMembershipService'
import type { IChatMemberRepository } from '../../chats/IChatMemberRepository'
import { cleanJid } from '../../../utils'

export class ContactGroupSubscriber implements IWAEventSubscriber {
  constructor(
    private contactService: IContactService,
    private chatService: IChatService,
    private groupMembershipService: IGroupMembershipService,
    private chatMemberRepository: IChatMemberRepository
  ) {}

  register(bus: IWAEventBus): void {
    bus.on('contact:upserted',   this.onContactUpserted.bind(this))
    bus.on('contact:updated',    this.onContactUpdated.bind(this))
    bus.on('lid:mapped',         this.onLidMapped.bind(this))
    bus.on('group:updated',      this.onGroupUpdated.bind(this))
    bus.on('group:participants', this.onGroupParticipants.bind(this))
  }

  dispose(): void {
    // Bus teardown handles listener removal
  }

  // ── Handlers ────────────────────────────────────────────────────────────────

  private async onContactUpserted(event: ContactUpsertedEvent): Promise<void> {
    for (const contact of event.contacts) {
      const cleanContact = {
        ...contact,
        id: cleanJid(contact.id),
        lid: contact.lid ? cleanJid(contact.lid) : undefined,
        phoneNumber: contact.phoneNumber ? cleanJid(contact.phoneNumber) : undefined
      }
      await this.contactService.upsertContact(cleanContact).catch((err) => {
        console.error('[ContactGroupSubscriber] Failed to upsert contact in onContactUpserted:', err)
      })

      if (
        contact.lid &&
        contact.id &&
        !String(contact.id).endsWith('@lid') &&
        String(contact.id).includes('@s.whatsapp.net')
      ) {
        await this.contactService
          .linkLidAndPn(cleanJid(contact.lid), cleanJid(contact.id), 'contacts.upsert')
          .catch((err) => {
            console.error('[ContactGroupSubscriber] Failed to link LID and PN in onContactUpserted:', err)
          })
      }
    }
  }

  private async onContactUpdated(event: ContactUpdatedEvent): Promise<void> {
    for (const contact of event.contacts) {
      const cleanContact = {
        ...contact,
        id: cleanJid(contact.id),
        lid: contact.lid ? cleanJid(contact.lid) : undefined,
        phoneNumber: contact.phoneNumber ? cleanJid(contact.phoneNumber) : undefined
      }
      await this.contactService
        .upsertContact(cleanContact, { overwriteName: true })
        .catch((err) => {
          console.error('[ContactGroupSubscriber] Failed to upsert contact in onContactUpdated:', err)
        })
    }
  }

  private async onLidMapped(event: LidMappingEvent): Promise<void> {
    for (const { lid, pn } of event.mappings) {
      if (lid && pn) {
        await this.contactService
          .linkLidAndPn(cleanJid(lid), cleanJid(pn), 'lid-mapping.update')
          .catch((err) => {
            console.error('[ContactGroupSubscriber] Failed to link LID and PN in onLidMapped:', err)
          })
      }
    }
  }

  private async onGroupUpdated(event: GroupUpdatedEvent): Promise<void> {
    for (const update of event.updates) {
      if (!update.id) continue
      const cleanGroupId = cleanJid(update.id)

      await this.chatService
         .upsertChat(cleanGroupId, { ...update, id: cleanGroupId })
         .catch((err) => {
            console.error('[ContactGroupSubscriber] Failed to upsert chat in onGroupUpdated:', err)
         })

      if (update.participants && update.participants.length > 0) {
        const cleanParticipants = update.participants.map((p) => ({
          ...p,
          id: cleanJid(p.id || p.userJid || '')
        }))
        await this.groupMembershipService
          .syncGroupMembers(cleanGroupId, cleanParticipants)
          .catch((err) => {
            console.error(`[ContactGroupSubscriber] Failed to sync members for ${cleanGroupId}:`, err)
          })
      }
    }
  }

  private async onGroupParticipants(event: GroupParticipantsEvent): Promise<void> {
    const { id, participants, action } = event
    const cleanGroupId = cleanJid(id)
    if (!cleanGroupId || !participants) return

    for (const jid of participants) {
      const cleanUserJid = cleanJid(jid)
      let identityId = await this.contactService.getIdentityIdByJid(cleanUserJid)

      if (!identityId) {
        await this.contactService.upsertContact({ id: cleanUserJid }).catch((err) => {
          console.error('[ContactGroupSubscriber] Failed to upsert contact in onGroupParticipants:', err)
        })
        identityId = await this.contactService.getIdentityIdByJid(cleanUserJid)
      }

      if (!identityId) continue

      if (action === 'add' || action === 'promote' || action === 'demote') {
        const role = action === 'promote' ? 'ADMIN' : 'MEMBER'
        await this.chatMemberRepository.upsertChatMember(cleanGroupId, identityId, role).catch((err) => {
          console.error('[ContactGroupSubscriber] Failed to upsert ChatMember in onGroupParticipants:', err)
        })
      } else if (action === 'remove') {
        await this.chatMemberRepository.deleteChatMember(cleanGroupId, identityId).catch((err) => {
          console.error('[ContactGroupSubscriber] Failed to delete ChatMember in onGroupParticipants:', err)
        })
      }
    }
  }
}
