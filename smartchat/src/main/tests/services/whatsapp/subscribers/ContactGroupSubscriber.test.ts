import { describe, it, expect, vi, beforeEach, Mocked } from 'vitest'
import { ContactGroupSubscriber } from '../../../../services/whatsapp/subscribers/ContactGroupSubscriber'
import type { IContactMutationService, IContactQueryService } from '../../../../services/contacts/IContactService'
import type { IChatService } from '../../../../services/chats/IChatService'
import type { IGroupMembershipService } from '../../../../services/chats/IGroupMembershipService'
import type { IChatMemberRepository } from '../../../../services/chats/IChatMemberRepository'
import type { IWAEventBus, AsyncHandler } from '../../../../services/whatsapp/IWAEventBus'
import type {
  ContactUpsertedEvent,
  LidMappingEvent,
  GroupUpdatedEvent,
  GroupParticipantsEvent
} from '../../../../services/whatsapp/WAEventTypes'

class MockEventBus implements IWAEventBus {
  private handlers = new Map<string, AsyncHandler<any>[]>()
  on(event: string, handler: AsyncHandler<any>): this {
    if (!this.handlers.has(event)) this.handlers.set(event, [])
    this.handlers.get(event)!.push(handler)
    return this
  }
  off(event: string, handler: AsyncHandler<any>): this {
    const list = this.handlers.get(event)
    if (list) this.handlers.set(event, list.filter(h => h !== handler))
    return this
  }
  async emit(event: string, data: any): Promise<void> {
    const list = this.handlers.get(event) || []
    for (const handler of list) await handler(data)
  }
  removeAllListeners(): void { this.handlers.clear() }
}

describe('ContactGroupSubscriber', () => {
  let contactService: Mocked<IContactMutationService & IContactQueryService>
  let chatService: Mocked<IChatService>
  let groupMembershipService: Mocked<IGroupMembershipService>
  let chatMemberRepository: Mocked<IChatMemberRepository>
  let bus: MockEventBus
  let subscriber: ContactGroupSubscriber

  beforeEach(() => {
    contactService = {
      upsertContact: vi.fn().mockResolvedValue(undefined),
      deleteContact: vi.fn().mockResolvedValue(undefined),
      linkLidAndPn: vi.fn().mockResolvedValue(undefined),
      updateContactProfilePic: vi.fn().mockResolvedValue(undefined),
      updateContactAbout: vi.fn().mockResolvedValue(undefined),
      getContactByJid: vi.fn(),
      searchContacts: vi.fn(),
      getContactIdsByJids: vi.fn(),
      getIdentityIdByJid: vi.fn(),
    } as any

    chatService = {
      upsertChat: vi.fn().mockResolvedValue(undefined),
      updateTimestamp: vi.fn().mockResolvedValue(undefined),
      incrementUnread: vi.fn().mockResolvedValue(undefined),
      deleteChat: vi.fn().mockResolvedValue(undefined),
      isChatMuted: vi.fn().mockResolvedValue(false),
      toggleMute: vi.fn().mockResolvedValue(undefined),
      toggleArchive: vi.fn().mockResolvedValue(undefined),
      togglePin: vi.fn().mockResolvedValue(undefined),
    } as any

    groupMembershipService = {
      syncGroupMembers: vi.fn().mockResolvedValue(undefined),
      linkGroupMetadataOwners: vi.fn().mockResolvedValue(undefined)
    }

    chatMemberRepository = {
      upsertChatMember: vi.fn().mockResolvedValue(undefined),
      deleteChatMember: vi.fn().mockResolvedValue(undefined),
      getChatMembers: vi.fn().mockResolvedValue([]),
    } as any

    bus = new MockEventBus()
    subscriber = new ContactGroupSubscriber(
      contactService,
      chatService,
      groupMembershipService,
      chatMemberRepository
    )
    subscriber.register(bus)
  })

  it('should handle contact:upserted', async () => {
    const event: ContactUpsertedEvent = {
      contacts: [{ id: '123@s.whatsapp.net', lid: '987@lid', name: 'Test' }]
    } as any
    await bus.emit('contact:upserted', event)
    expect(contactService.upsertContact).toHaveBeenCalledWith(
      expect.objectContaining({ id: '123@s.whatsapp.net', lid: '987@lid' }),
      { overwriteName: true }
    )
    expect(contactService.linkLidAndPn).toHaveBeenCalledWith('987@lid', '123@s.whatsapp.net', 'contacts.upsert')
  })

  it('should handle lid:mapped', async () => {
    const event: LidMappingEvent = {
      mappings: [{ lid: '456@lid', pn: '555@s.whatsapp.net' }]
    } as any
    await bus.emit('lid:mapped', event)
    expect(contactService.linkLidAndPn).toHaveBeenCalledWith('456@lid', '555@s.whatsapp.net', 'lid-mapping.update')
  })

  it('should handle group:updated', async () => {
    const event: GroupUpdatedEvent = {
      updates: [{ id: 'group@g.us', subject: 'Test Group', participants: [{ id: 'user@s.whatsapp.net' }] }]
    } as any
    await bus.emit('group:updated', event)
    expect(chatService.upsertChat).toHaveBeenCalledWith('group@g.us', expect.objectContaining({ subject: 'Test Group' }))
    expect(groupMembershipService.syncGroupMembers as any).toHaveBeenCalledWith('group@g.us', expect.any(Array) as any)
  })

  it('should handle group:participants (add)', async () => {
    contactService.getIdentityIdByJid.mockResolvedValue(1)
    const event: GroupParticipantsEvent = {
      id: 'group@g.us',
      participants: ['newuser@s.whatsapp.net'],
      action: 'add'
    } as any
    await bus.emit('group:participants', event)
    expect(chatMemberRepository.upsertChatMember).toHaveBeenCalledWith('group@g.us', 1, 'MEMBER')
  })
})
