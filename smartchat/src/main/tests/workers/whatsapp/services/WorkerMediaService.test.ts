import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import * as fs from 'fs'
import * as os from 'os'
import { join } from 'path'
import { WorkerMediaService } from '../../../../workers/whatsapp/services/WorkerMediaService'

vi.mock('@whiskeysockets/baileys', async (importOriginal) => {
  const mod = await importOriginal<typeof import('@whiskeysockets/baileys')>()
  return {
    ...mod,
    downloadContentFromMessage: vi.fn().mockImplementation(async function* () {
      yield Buffer.from('fake-sticker-bytes')
    })
  }
})

/**
 * Batch D — Slice 1.
 *
 * S1-03: for templateMessage-wrapped media the resolved media node must be a
 *        live reference into rawMessage so that `localURI` lands in the
 *        persisted content (otherwise every open re-downloads).
 * S1-04: clearFavoriteStickerQueue() zeroed activeDownloadsCount while
 *        downloads were still in flight; their `.finally` then drove the
 *        counter negative and silently raised the concurrency cap.
 */

describe('WorkerMediaService', () => {
  let userDataPath: string
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let deps: any
  let service: WorkerMediaService

  beforeEach(() => {
    userDataPath = fs.mkdtempSync(join(os.tmpdir(), 'wms-test-'))
    deps = {
      messageRepository: {
        updateContentAndFetchWithSender: vi.fn()
      },
      messageQueryRepository: {
        findMessageById: vi.fn()
      },
      messageEnricher: { enrichMessage: vi.fn().mockResolvedValue({ id: 'x' }) },
      contactService: { batchResolveNames: vi.fn().mockResolvedValue(new Map()) },
      favoriteStickerService: {
        handleDownloadedSticker: vi.fn().mockResolvedValue(undefined),
        findFavoritesByHashes: vi.fn().mockResolvedValue([])
      }
    }
    service = new WorkerMediaService(
      deps.messageRepository,
      deps.messageQueryRepository,
      deps.messageEnricher,
      deps.contactService,
      deps.favoriteStickerService,
      userDataPath
    )
  })

  afterEach(() => {
    fs.rmSync(userDataPath, { recursive: true, force: true })
    vi.clearAllMocks()
  })

  it('S1-03: persists localURI into a templateMessage-wrapped media node', async () => {
    const rawMessage = {
      templateMessage: {
        hydratedTemplate: {
          imageMessage: {
            url: 'https://mmg.whatsapp.net/x.enc',
            mediaKey: Buffer.from('01234567890123456789012345678901'),
            fileSha256: Buffer.from('abcabcabcabcabcabcabcabcabcabcab')
          }
        }
      }
    }
    deps.messageQueryRepository.findMessageById.mockResolvedValue({
      id: 'tmpl-1',
      chatJid: 'c@s.whatsapp.net',
      fromMe: false,
      participant: null,
      content: JSON.stringify(rawMessage)
    })
    deps.messageRepository.updateContentAndFetchWithSender.mockResolvedValue({
      id: 'tmpl-1',
      chatJid: 'c@s.whatsapp.net',
      participant: null
    })

    await service.downloadAndCacheMedia('tmpl-1', {} as never)

    expect(deps.messageRepository.updateContentAndFetchWithSender).toHaveBeenCalledTimes(1)
    const persisted = JSON.parse(
      deps.messageRepository.updateContentAndFetchWithSender.mock.calls[0][1]
    )
    expect(persisted.templateMessage.hydratedTemplate.imageMessage.localURI).toMatch(
      /^app:\/\/media\//
    )
  })

  it('S1-04: leftover in-flight downloads do not drive activeDownloadsCount negative', async () => {
    let releaseDownload: () => void = () => {}
    const gate = new Promise<void>((resolve) => {
      releaseDownload = resolve
    })
    // Make the download hang until we release it.
    vi.spyOn(service, 'downloadAndCacheMedia').mockImplementation(async () => {
      await gate
      return { id: 'x' } as never
    })

    // Queue two downloads (concurrencyLimit = 2) -> both go in flight.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ;(service as any).queueFavoriteStickerDownload('m1', {})
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ;(service as any).queueFavoriteStickerDownload('m2', {})
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((service as any).activeDownloadsCount).toBe(2)

    // Sync teardown clears the queue and zeroes the counter mid-flight.
    service.clearFavoriteStickerQueue()
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((service as any).activeDownloadsCount).toBe(0)

    // Now let the stale downloads settle — their .finally must be ignored.
    releaseDownload()
    await new Promise((r) => setTimeout(r, 0))
    await new Promise((r) => setTimeout(r, 0))

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((service as any).activeDownloadsCount).toBe(0)
  })
})
