import { join } from 'path'
import * as fs from 'fs'
import { app } from 'electron'
import ffmpeg from 'fluent-ffmpeg'
import ffmpegStatic from 'ffmpeg-static'
// @ts-ignore
import WebP from 'node-webpmux'

export class StickerMetadataService {
  constructor() {
    if (ffmpegStatic) {
      const ffmpegPath = ffmpegStatic.replace('app.asar', 'app.asar.unpacked')
      ffmpeg.setFfmpegPath(ffmpegPath)
    }
  }

  /**
   * Resizes/crops WebP stickers to 512x512 with transparent padding if needed,
   * checks file size limits, and injects/preserves EXIF metadata.
   */
  async processAndAddMetadata(
    inputPath: string,
    packName: string = 'SmartChat Pack',
    author: string = 'SmartChat',
    emojis: string[] = ['✨']
  ): Promise<string> {
    const tempDir = join(app.getPath('userData'), 'temp_stickers')
    if (!fs.existsSync(tempDir)) {
      fs.mkdirSync(tempDir, { recursive: true })
    }

    const outPath = join(tempDir, `processed_${Date.now()}_${Math.random().toString(36).substring(7)}.webp`)

    // Load webp info to check dimensions, size, and existing EXIF
    const img = new WebP.Image()
    await img.load(inputPath)

    const width = img.width || 0
    const height = img.height || 0
    const hasAnim = img.hasAnim || false
    const fileSize = fs.statSync(inputPath).size

    const sizeLimit = hasAnim ? 500 * 1024 : 100 * 1024

    // Save existing EXIF if it exists, otherwise generate default
    let exifBuffer = img.exif

    if (!exifBuffer || exifBuffer.length === 0) {
      const json = {
        'sticker-pack-id': 'smartchat.sticker.pack.default',
        'sticker-pack-name': packName,
        'sticker-pack-publisher': author,
        'emojis': emojis
      }

      const exifHeader = Buffer.from([
        0x49, 0x49, 0x2a, 0x00, 0x08, 0x00, 0x00, 0x00, 
        0x01, 0x00, 0x41, 0x57, 0x07, 0x00, 0x00, 0x00, 
        0x00, 0x00, 0x16, 0x00, 0x00, 0x00
      ])

      const jsonBuffer = Buffer.from(JSON.stringify(json), 'utf8')
      const exifAttr = Buffer.alloc(exifHeader.length)
      exifHeader.copy(exifAttr)
      exifAttr.writeUInt32LE(jsonBuffer.length, 14)

      exifBuffer = Buffer.concat([exifAttr, jsonBuffer])
    }

    const needsRescale = width !== 512 || height !== 512 || fileSize > sizeLimit

    let processedPath = inputPath
    if (needsRescale) {
      console.log(`[StickerMetadataService] Rescaling sticker: current size ${fileSize} bytes, dims ${width}x${height}`)
      processedPath = await new Promise<string>((resolve) => {
        const ff = ffmpeg(inputPath)
          .outputOptions([
            '-vf',
            'scale=512:512:force_original_aspect_ratio=decrease,pad=512:512:-1:-1:color=0x00000000',
            '-pix_fmt',
            'rgba'
          ])
        
        if (hasAnim) {
          ff.outputOptions(['-loop', '0'])
        }

        ff.on('end', () => {
          resolve(outPath)
        })
        .on('error', (err) => {
          console.error('[StickerMetadataService] ffmpeg resize error:', err)
          // Fall back to original file if resizing fails
          resolve(inputPath)
        })
        .save(outPath)
      })
    }

    // Now, load the processed file and inject the EXIF buffer
    const finalImg = new WebP.Image()
    await finalImg.load(processedPath)
    finalImg.exif = exifBuffer

    // Save to final file path
    const finalPath = join(tempDir, `final_${Date.now()}_${Math.random().toString(36).substring(7)}.webp`)
    await finalImg.save(finalPath)

    // Cleanup the intermediate ffmpeg processed file if it was created
    if (processedPath !== inputPath && fs.existsSync(processedPath)) {
      try {
        fs.unlinkSync(processedPath)
      } catch (e: unknown) {
        console.warn('[StickerMetadataService] Failed to clean up processed temp file:', e)
      }
    }

    // Check size limit on the final file
    const finalSize = fs.statSync(finalPath).size
    if (finalSize > sizeLimit) {
      console.warn(`[StickerMetadataService] Final sticker size (${finalSize} bytes) exceeds limit (${sizeLimit} bytes)`)
    }

    return finalPath
  }
}

export const stickerMetadataService = new StickerMetadataService()
