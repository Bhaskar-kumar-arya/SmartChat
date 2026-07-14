import { describe, it, expect, vi, beforeEach } from 'vitest'
import { FavoriteStickerService } from '../../services/messages/FavoriteStickerService'

import * as fs from 'fs'

vi.mock('electron', () => ({
  app: {
    getPath: vi.fn().mockReturnValue('/mock/path')
  }
}))

vi.mock('fs', () => ({
  existsSync: vi.fn().mockReturnValue(true),
  mkdirSync: vi.fn(),
  copyFileSync: vi.fn(),
  unlinkSync: vi.fn(),
  writeFileSync: vi.fn(),
}))

describe('FavoriteStickerService', () => {
  let service: FavoriteStickerService
  let prisma: any

  beforeEach(() => {
    prisma = {
      message: {
        findUnique: vi.fn()
      },
      favoriteSticker: {
        upsert: vi.fn(),
        delete: vi.fn(),
        findUnique: vi.fn(),
        count: vi.fn(),
        findMany: vi.fn(),
      }
    }
    service = new FavoriteStickerService(prisma)
  })

  it('isStickerFavorite returns true if count > 0', async () => {
    prisma.message.findUnique.mockResolvedValue({
      id: 'm1',
      content: JSON.stringify({ stickerMessage: { fileSha256: 'xyz' } })
    })
    prisma.favoriteSticker.count.mockResolvedValue(1)

    const isFav = await service.isStickerFavorite('m1')
    expect(isFav).toBe(true)
  })

  it('isStickerFavorite returns false if message not found', async () => {
    prisma.message.findUnique.mockResolvedValue(null)
    const isFav = await service.isStickerFavorite('m1')
    expect(isFav).toBe(false)
  })

  it('getFavoriteStickers returns mapped DTOs', async () => {
    prisma.favoriteSticker.findMany.mockResolvedValue([
      { id: '1', fileSha256: 'abc', fileName: 'abc.webp', createdAt: 1000n }
    ])

    const favs = await service.getFavoriteStickers()
    expect(favs).toHaveLength(1)
    expect(favs[0].id).toBe('1')
    expect(favs[0].localURI).toBe('app://favourites/abc.webp')
    expect(favs[0].createdAt).toBe(1000)
  })

  it('removeFavoriteStickerBySha deletes from db and fs if no other refs', async () => {
    prisma.favoriteSticker.findUnique.mockResolvedValue({ fileName: 'xyz.webp', fileSha256: 'xyz' })
    prisma.favoriteSticker.count.mockResolvedValue(0)

    vi.mocked(fs.existsSync).mockReturnValue(true)

    const res = await service.removeFavoriteStickerBySha('xyz')
    expect(res).toBe(true)
    expect(prisma.favoriteSticker.delete).toHaveBeenCalledWith({ where: { fileSha256: 'xyz' } })
    expect(vi.mocked(fs.unlinkSync)).toHaveBeenCalled()
  })

  it('addStickerToFavorites adds to db and copies file', async () => {
    prisma.message.findUnique.mockResolvedValue({
      id: 'm1',
      content: JSON.stringify({ stickerMessage: { fileSha256: 'abc' } })
    })
    
    const res = await service.addStickerToFavorites('m1')
    expect(res).toBe(true)
    expect(prisma.favoriteSticker.upsert).toHaveBeenCalled()
    expect(vi.mocked(fs.copyFileSync)).toHaveBeenCalled()
  })
})
