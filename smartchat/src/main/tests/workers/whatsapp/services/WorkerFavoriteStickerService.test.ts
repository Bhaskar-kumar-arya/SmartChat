import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import * as fs from 'fs'
import * as os from 'os'
import { join } from 'path'
import { WorkerFavoriteStickerService } from '../../../../workers/whatsapp/services/WorkerFavoriteStickerService'
import { getSafeMediaFileName } from '../../../../services/messages/MediaHelper'

/**
 * Batch D — Slice 1.
 *
 * S1-05: WorkerMediaService writes cached sticker files under the name from
 *        getSafeMediaFileName (hex-encoded sha), but this service derived the
 *        name from extractStickerSha (base64), so "add to favorites" could
 *        never locate an already-cached sticker whose fileSha256 wasn't a
 *        plain string, and threw "not downloaded or cached yet".
 */

describe('WorkerFavoriteStickerService — S1-05 sticker filename parity', () => {
  let userDataPath: string
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let prisma: any
  let service: WorkerFavoriteStickerService

  const bufferSha = Buffer.from('9f'.repeat(32), 'hex')
  const stickerMsg = {
    fileSha256: { type: 'Buffer', data: Array.from(bufferSha) },
    mediaKey: Buffer.from('k'.repeat(32))
  }
  const rawMessage = { stickerMessage: stickerMsg }

  beforeEach(() => {
    userDataPath = fs.mkdtempSync(join(os.tmpdir(), 'wfs-test-'))
    prisma = {
      message: { findUnique: vi.fn() },
      favoriteSticker: { upsert: vi.fn().mockResolvedValue({}) }
    }
    service = new WorkerFavoriteStickerService(prisma, userDataPath)
  })

  afterEach(() => {
    fs.rmSync(userDataPath, { recursive: true, force: true })
    vi.clearAllMocks()
  })

  it('derives the same filename WorkerMediaService caches under', () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const derived = (service as any).getStickerFileName(stickerMsg, 'msg-1')
    expect(derived).toBe(getSafeMediaFileName('msg-1', 'sticker', stickerMsg))
    expect(derived).toMatch(/^hash_[0-9a-f]+\.webp$/) // hex, not base64
  })

  it('addStickerToFavorites finds a sticker cached under the hex name', async () => {
    prisma.message.findUnique.mockResolvedValue({
      id: 'msg-1',
      content: JSON.stringify(rawMessage)
    })

    // Simulate WorkerMediaService having cached the file.
    const cachedName = getSafeMediaFileName('msg-1', 'sticker', stickerMsg)
    const mediaDir = join(userDataPath, 'media')
    fs.mkdirSync(mediaDir, { recursive: true })
    fs.writeFileSync(join(mediaDir, cachedName), Buffer.from('webp-bytes'))

    await expect(service.addStickerToFavorites('msg-1')).resolves.toBe(true)
    expect(fs.existsSync(join(userDataPath, 'favourites', cachedName))).toBe(true)
    expect(prisma.favoriteSticker.upsert).toHaveBeenCalledTimes(1)
  })
})
