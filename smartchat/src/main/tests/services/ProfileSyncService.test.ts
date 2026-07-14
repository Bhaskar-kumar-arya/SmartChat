import { describe, it, expect, vi, beforeEach } from 'vitest'
import { ProfileSyncService } from '../../services/contacts/ProfileSyncService'
import { IIdentityRepository } from '../../services/contacts/IIdentityRepository'
import { IChatRepository } from '../../services/chats/IChatRepository'
import { IContactQueryService } from '../../services/contacts/IContactService'

describe('ProfileSyncService', () => {
  let service: ProfileSyncService
  let identityRepo: import('vitest').Mocked<IIdentityRepository>
  let chatRepo: import('vitest').Mocked<IChatRepository>
  let contactService: import('vitest').Mocked<IContactQueryService>
  let mockSock: any

  beforeEach(() => {
    identityRepo = {
      findIdentityById: vi.fn(),
      updateIdentity: vi.fn(),
    } as any

    chatRepo = {
      findChatByJid: vi.fn(),
      upsertChat: vi.fn(),
    } as any

    contactService = {
      getIdentityIdByJid: vi.fn(),
    } as any

    mockSock = {
      profilePictureUrl: vi.fn(),
    }

    service = new ProfileSyncService(identityRepo, chatRepo, contactService)
  })

  it('getProfilePicture returns null if no sock and not cached', async () => {
    const url = await service.getProfilePicture('test@g.us', 'image', null)
    expect(url).toBeNull()
  })

  it('getProfilePicture fetches from chatRepo if preview and not forced', async () => {
    chatRepo.findChatByJid.mockResolvedValue({ profilePictureUrl: 'http://test.com/pic.jpg' } as any)
    const url = await service.getProfilePicture('test@g.us', 'preview', null, false)
    expect(url).toBe('http://test.com/pic.jpg')
    expect(chatRepo.findChatByJid).toHaveBeenCalledWith('test@g.us')
  })

  it('getProfilePicture fetches from sock and caches it for image', async () => {
    mockSock.profilePictureUrl.mockResolvedValue('http://test.com/new.jpg')
    const url = await service.getProfilePicture('test@g.us', 'image', mockSock, true)
    expect(url).toBe('http://test.com/new.jpg')
    
    // Test that the cache was populated
    const urlCached = await service.getProfilePicture('test@g.us', 'image', null, false)
    expect(urlCached).toBe('http://test.com/new.jpg')
  })
})
