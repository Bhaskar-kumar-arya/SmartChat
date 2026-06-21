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
      ffmpeg.setFfmpegPath(ffmpegPath)
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
    const outPath = join(tempDir, `converted_${fileName}`)

    return new Promise((resolve) => {
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
          // Fallback: resolution with original path if transcoding fails
          resolve(inputPath)
        })
        .save(outPath)
    })
  }
}

export const audioTranscoderService = new AudioTranscoderService()
