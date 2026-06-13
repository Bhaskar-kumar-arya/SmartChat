/**
 * ContactGroupSubscriber
 * ======================
 * Listens to contact and group domain events and delegates to the appropriate
 * services for persistence.
 *
 * Single responsibility: contact/group data management only.
 */

import { PrismaClient } from '@prisma/client'
import type { WAEventBus } from '../WAEventBus'
import type { IWAEventSubscriber } from './IWAEventSubscriber'
import type {
  ContactUpsertedEvent,
  ContactUpdatedEvent,
  LidMappingEvent,
  GroupUpdatedEvent,
  GroupParticipantsEvent,
} from '../WAEventTypes'
import type { ServiceContainer } from '../../../ServiceContainer'
import { cleanJid } from '../../../utils'

export class ContactGroupSubscriber implements IWAEventSubscriber {
  constructor(
    private services: ServiceContainer,
    private prisma: PrismaClient
  ) {}

  register(bus: WAEventBus): void {
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
      await this.services.contactService.upsertContact(cleanContact).catch(() => {})

      if (
        contact.lid &&
        contact.id &&
        !String(contact.id).endsWith('@lid') &&
        String(contact.id).includes('@s.whatsapp.net')
      ) {
        await this.services.contactService
          .linkLidAndPn(cleanJid(contact.lid), cleanJid(contact.id), 'contacts.upsert')
          .catch(() => {})
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
      await this.services.contactService
        .upsertContact(cleanContact, { overwriteName: true })
        .catch(() => {})
    }
  }

  private async onLidMapped(event: LidMappingEvent): Promise<void> {
    for (const { lid, pn } of event.mappings) {
      if (lid && pn) {
        await this.services.contactService
          .linkLidAndPn(cleanJid(lid), cleanJid(pn), 'lid-mapping.update')
          .catch(() => {})
      }
    }
  }

  private async onGroupUpdated(event: GroupUpdatedEvent): Promise<void> {
    for (const update of event.updates) {
      if (!update.id) continue
      const cleanGroupId = cleanJid(update.id)

      await this.services.chatService
         .upsertChat(cleanGroupId, { ...update, id: cleanGroupId })
         .catch(() => {})

      if (update.participants && update.participants.length > 0) {
        const cleanParticipants = update.participants.map((p) => ({
          ...p,
          id: cleanJid(p.id || p.userJid || '')
        }))
        await this.services.chatService
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
      let identityId = await this.services.contactService.getIdentityIdByJid(cleanUserJid)

      if (!identityId) {
        await this.services.contactService.upsertContact({ id: cleanUserJid }).catch(() => {})
        identityId = await this.services.contactService.getIdentityIdByJid(cleanUserJid)
      }

      if (!identityId) continue

      if (action === 'add' || action === 'promote' || action === 'demote') {
        const role = action === 'promote' ? 'ADMIN' : 'MEMBER'
        await this.prisma.chatMember.upsert({
          where: { chatJid_identityId: { chatJid: cleanGroupId, identityId } },
          update: { role },
          create: { chatJid: cleanGroupId, identityId, role }
        }).catch(() => {})
      } else if (action === 'remove') {
        await this.prisma.chatMember.delete({
          where: { chatJid_identityId: { chatJid: cleanGroupId, identityId } }
        }).catch(() => {})
      }
    }
  }
}
