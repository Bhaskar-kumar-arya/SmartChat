import { describe, it, expect, beforeEach } from 'vitest'
import { join } from 'path'
import fs from 'fs'
import { app } from 'electron'
import { StickerMetadataService } from '../../../services/messages/StickerMetadataService'

/** P2-S2-08 — temp_stickers must be swept on startup so leaked webp files don't grow unbounded. */
describe('StickerMetadataService.sweepTempDir (P2-S2-08)', () => {
  const tempDir = join(app.getPath('userData'), 'temp_stickers')

  beforeEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true })
  })

  it('removes every leftover file in temp_stickers', () => {
    fs.mkdirSync(tempDir, { recursive: true })
    fs.writeFileSync(join(tempDir, 'processed_123_abc.webp'), 'x')
    fs.writeFileSync(join(tempDir, 'final_456_def.webp'), 'y')

    StickerMetadataService.sweepTempDir()

    expect(fs.existsSync(tempDir)).toBe(true)
    expect(fs.readdirSync(tempDir)).toEqual([])
  })

  it('is a no-op when the directory does not exist', () => {
    expect(() => StickerMetadataService.sweepTempDir()).not.toThrow()
  })
})
