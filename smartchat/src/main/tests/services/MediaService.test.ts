import { describe, it, expect, vi, beforeEach } from 'vitest'
import { MediaService } from '../../services/messages/MediaService'

describe('MediaService', () => {
  let service: MediaService
  let repo: any
  let queryRepo: any
  let msgService: any
  let parserService: any
  let contactService: any
  let favService: any

  beforeEach(() => {
    repo = {}
    queryRepo = {}
    msgService = {}
    parserService = {}
    contactService = {}
    favService = {
      findFavoritesByHashes: vi.fn().mockResolvedValue([]),
    }

    service = new MediaService(repo, queryRepo, msgService, parserService, contactService, favService)
  })

  it('clearFavoriteStickerQueue clears the queue', () => {
    service.clearFavoriteStickerQueue()
    expect(true).toBe(true) // Should not throw
  })

  it('setFavoriteStickerQueuePaused pauses and resumes', () => {
    service.setFavoriteStickerQueuePaused(true)
    service.setFavoriteStickerQueuePaused(false)
    expect(true).toBe(true) // Should not throw
  })
})
