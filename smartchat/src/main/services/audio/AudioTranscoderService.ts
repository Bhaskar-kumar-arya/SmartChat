import { join } from 'path'
import * as fs from 'fs'
import ffmpeg from 'fluent-ffmpeg'
import ffmpegStatic from 'ffmpeg-static'

/**
 * Service for handling audio transcoding and manipulations.
 * Follows SRP by isolating FFmpeg logic from IPC handlers.
 */
export class AudioTranscoderService {
  constructor() {
    if (ffmpegStatic) {
      const ffmpegPath = ffmpegStatic.replace('app.asar', 'app.asar.unpacked')
      if (fs.existsSync(ffmpegPath)) {
        ffmpeg.setFfmpegPath(ffmpegPath)
      } else {
        console.warn(`[AudioTranscoder] FFmpeg path from ffmpeg-static does not exist: ${ffmpegPath}`)
      }
    }
  }

  /**
   * Transcodes an input audio file to WhatsApp-compliant Ogg Opus format.
   * @param inputPath Path to the source audio file (e.g., recorded WebM)
   * @param tempDir Directory where the output should be saved
   * @returns Promise resolving to the path of the transcoded file
   */
  async transcodeToWAPtt(inputPath: string, tempDir: string): Promise<string> {
    const fileName = inputPath.split(/[\\/]/).pop() || `voice_${Date.now()}.ogg`
    // S11-06: unique output name so concurrent transcodes of same-basename
    // inputs don't collide on `converted_<name>`.
    const outPath = join(tempDir, `converted_${Date.now()}_${Math.random().toString(36).slice(2, 8)}_${fileName}`)

    return new Promise<string>((resolve, reject) => {
      ffmpeg(inputPath)
        .outputOptions([
          '-c:a libopus',
          '-ac 1',
          '-avoid_negative_ts make_zero'
        ])
        .toFormat('ogg')
        .on('end', () => {
          try {
            // Clean up the original file after successful transcoding
            if (fs.existsSync(inputPath)) {
              fs.unlinkSync(inputPath)
            }
          } catch (e) {
            console.warn('[AudioTranscoder] Failed to delete source file:', e)
          }
          resolve(outPath)
        })
        .on('error', (err: Error) => {
          console.error('[AudioTranscoder] Transcoding error:', err)
          // S11-06: reject rather than resolve with the untranscoded input —
          // returning the raw WebM produced an unplayable/rejected PTT on the
          // recipient side with no error surfaced to the sender.
          try {
            if (fs.existsSync(outPath)) fs.unlinkSync(outPath)
          } catch (cleanupErr) {
            console.warn('[AudioTranscoder] Failed to delete partial output:', cleanupErr)
          }
          reject(err instanceof Error ? err : new Error(String(err)))
        })
        .save(outPath)
    })
  }
}

export const audioTranscoderService = new AudioTranscoderService()
