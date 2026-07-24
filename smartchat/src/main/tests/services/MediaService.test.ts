import { describe, it, expect, vi, beforeEach } from 'vitest'
import { MediaService } from '../../services/messages/MediaService'

vi.mock('@whiskeysockets/baileys', async (importOriginal) => {
  const mod = await importOriginal<typeof import('@whiskeysockets/baileys')>()
  return {
    ...mod,
    downloadContentFromMessage: vi.fn().mockImplementation((_msg, _type) => {
      const err: any = new Error('HTTP 404 Not Found')
      err.statusCode = 404
      err.output = { statusCode: 404 }
      throw err
    })
  }
})

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

  it('downloadAndCacheMedia invokes sock.updateMediaMessage on 404 primary failure', async () => {
    const rawMsg = {
      imageMessage: {
        url: 'https://mmg.whatsapp.net/v/t62.7118-24/12345.enc',
        mediaKey: Buffer.from('12345678901234567890123456789012')
      }
    }
    queryRepo.findMessageById = vi.fn().mockResolvedValue({
      id: 'msg-404',
      chatJid: 'chat@s.whatsapp.net',
      fromMe: false,
      participant: null,
      content: JSON.stringify(rawMsg)
    })
    parserService.getSafeMediaFileName = vi.fn().mockReturnValue('msg-404.jpg')
    repo.updateContentAndFetchWithSender = vi.fn().mockResolvedValue({
      id: 'msg-404',
      chatJid: 'chat@s.whatsapp.net',
      content: JSON.stringify(rawMsg)
    })
    contactService.batchResolveNames = vi.fn().mockResolvedValue(new Map())
    msgService.enrichMessage = vi.fn().mockResolvedValue({ id: 'msg-404', mediaUrl: 'app://media/msg-404.jpg' })

    const mockSock: any = {
      updateMediaMessage: vi.fn().mockRejectedValue(new Error('AES-GCM decryption failed'))
    }

    await expect(service.downloadAndCacheMedia('msg-404', mockSock)).rejects.toThrow('updateMediaMessage request failed: AES-GCM decryption failed')
    expect(mockSock.updateMediaMessage).toHaveBeenCalledWith(expect.objectContaining({
      key: expect.objectContaining({ id: 'msg-404', remoteJid: 'chat@s.whatsapp.net' })
    }))
  })
})
