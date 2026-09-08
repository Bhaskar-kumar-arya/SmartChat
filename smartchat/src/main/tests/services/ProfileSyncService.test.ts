import { describe, it, expect, vi, beforeEach } from 'vitest'
import { ProfileSyncService, isProfilePictureUrlExpired } from '../../services/contacts/ProfileSyncService'
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
      updateIdentity: vi.fn().mockResolvedValue(undefined),
    } as any

    chatRepo = {
      findChatByJid: vi.fn(),
      upsertChat: vi.fn().mockResolvedValue(undefined),
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

  it('P2-S5-05: isProfilePictureUrlExpired detects an elapsed oe param', () => {
    const past = Math.floor(Date.now() / 1000 - 3600).toString(16)
    const future = Math.floor(Date.now() / 1000 + 3600).toString(16)
    expect(isProfilePictureUrlExpired(`https://cdn/x.jpg?oe=${past}&oh=abc`)).toBe(true)
    expect(isProfilePictureUrlExpired(`https://cdn/x.jpg?oe=${future}&oh=abc`)).toBe(false)
    expect(isProfilePictureUrlExpired('https://cdn/x.jpg')).toBe(false)
    expect(isProfilePictureUrlExpired(null)).toBe(false)
  })

  it('P2-S5-05: a stored but expired group URL is refetched instead of returned', async () => {
    const past = Math.floor(Date.now() / 1000 - 3600).toString(16)
    chatRepo.findChatByJid.mockResolvedValue({ profilePictureUrl: `https://cdn/old.jpg?oe=${past}` } as any)
    mockSock.profilePictureUrl.mockResolvedValue('https://cdn/fresh.jpg')

    const url = await service.getProfilePicture('grp@g.us', 'preview', mockSock, false)
    expect(url).toBe('https://cdn/fresh.jpg')
  })

  it('P2-S5-04: "no picture" results are negatively cached (no repeat network hit)', async () => {
    chatRepo.findChatByJid.mockResolvedValue(null)
    mockSock.profilePictureUrl.mockResolvedValue(undefined)

    const first = await service.getProfilePicture('grp@g.us', 'preview', mockSock, false)
    const second = await service.getProfilePicture('grp@g.us', 'preview', mockSock, false)

    expect(first).toBeNull()
    expect(second).toBeNull()
    expect(mockSock.profilePictureUrl).toHaveBeenCalledTimes(1)
  })

  it('P2-S5-04: image cache is bounded (FIFO) and clearCache empties it', async () => {
    mockSock.profilePictureUrl.mockImplementation(async (jid: string) => `http://pic/${jid}`)
    for (let i = 0; i < 550; i++) {
      await service.getProfilePicture(`u${i}@g.us`, 'image', mockSock, true)
    }
    // u0 evicted (>500 entries), u549 still cached — read with no sock
    expect(await service.getProfilePicture('u0@g.us', 'image', null, false)).toBeNull()
    expect(await service.getProfilePicture('u549@g.us', 'image', null, false)).toBe('http://pic/u549@g.us')

    service.clearCache()
    expect(await service.getProfilePicture('u549@g.us', 'image', null, false)).toBeNull()
  })
})
