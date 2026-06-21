import { MediaSendOptions } from '../whatsapp/types'

/**
 * Prepares send options for media or document messages based on file type.
 */
export function getMediaSendOptions(filePath: string, buffer: Buffer, caption?: string): MediaSendOptions {
  const lowerPath = filePath.toLowerCase()
  
  if (lowerPath.endsWith('.webp')) return { sticker: buffer }
  if (['.mp4', '.mkv', '.avi', '.mov'].some(ext => lowerPath.endsWith(ext))) {
    const isGifPlayback = lowerPath.includes('gifplayback') || lowerPath.includes('giphy')
    return { video: buffer, caption, gifPlayback: isGifPlayback ? true : undefined }
  }
  if (['.jpg', '.jpeg', '.png', '.gif'].some(ext => lowerPath.endsWith(ext))) return { image: buffer, caption }
  if (['.ogg', '.opus', '.mp3', '.m4a'].some(ext => lowerPath.endsWith(ext))) {
      const isPtt = lowerPath.endsWith('.ogg') || lowerPath.endsWith('.opus')
      return { 
        audio: buffer, 
        mimetype: isPtt ? 'audio/ogg; codecs=opus' : undefined,
        ptt: isPtt 
      }
  }
  
  // Fallback to document message
  const ext = lowerPath.split('.').pop() || 'bin'
  const mimes: Record<string, string> = {
      'pdf': 'application/pdf',
      'doc': 'application/msword',
      'docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'xls': 'application/vnd.ms-excel',
      'xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'ppt': 'application/vnd.ms-powerpoint',
      'pptx': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
      'txt': 'text/plain',
      'zip': 'application/zip',
      'rar': 'application/x-rar-compressed'
  }

  return { 
      document: buffer, 
      fileName: filePath.split(/[\\/]/).pop(),
      mimetype: mimes[ext] || 'application/octet-stream',
      caption
  }
}

/**
 * Resolves the correct file extension for a media/document message based on its metadata.
 */
export function resolveExtension(mediaType: string, mediaMsg: unknown): string {
  if (mediaType === 'image') return 'jpg'
  if (mediaType === 'sticker') return 'webp'
  if (mediaType === 'video') return 'mp4'
  if (mediaType === 'audio') return 'ogg'
  
  if (mediaType === 'document') {
      const mediaObj = mediaMsg as Record<string, unknown> | null | undefined
      const mime = (mediaObj?.mimetype as string | undefined) || ''
      if (mime.includes('pdf')) return 'pdf'
      if (mime.includes('word')) return 'docx'
      if (mime.includes('sheet')) return 'xlsx'
      if (mime.includes('text')) return 'txt'
      
      const originalName = (mediaObj?.fileName as string | undefined) || ''
      if (originalName.includes('.')) return originalName.split('.').pop() || 'dat'
  }
  
  return 'dat'
}

/**
 * Build a safe, deduplication-friendly filename for a downloaded media file.
 */
export function getSafeMediaFileName(msgId: string, mediaType: string, mediaMsg: unknown): string {
  const ext = resolveExtension(mediaType, mediaMsg)

  let fileHash: string | null = null
  const mediaObj = mediaMsg as Record<string, unknown> | null | undefined
  if (mediaObj?.fileSha256) {
    const sha = mediaObj.fileSha256
    if (typeof sha === 'string') {
      fileHash = sha.replace(/[/\\?%*:|"<>+]/g, '-').substring(0, 64)
    } else if (Buffer.isBuffer(sha)) {
      fileHash = sha.toString('hex')
    } else if (
      sha &&
      typeof sha === 'object' &&
      'type' in sha &&
      (sha as { type: unknown }).type === 'Buffer' &&
      'data' in sha &&
      Array.isArray((sha as { data: unknown }).data)
    ) {
      fileHash = Buffer.from((sha as { data: number[] }).data).toString('hex')
    } else if (sha instanceof Uint8Array || Array.isArray(sha)) {
      fileHash = Buffer.from(sha as Uint8Array).toString('hex')
    }
  }

  if (mediaType === 'document' && mediaObj && typeof mediaObj.fileName === 'string') {
    const originalName = mediaObj.fileName.includes('.')
      ? mediaObj.fileName.substring(0, mediaObj.fileName.lastIndexOf('.'))
      : mediaObj.fileName
    const safeName = originalName.replace(/[/\\?%*:|"<>]/g, '-').substring(0, 80)
    const suffix = fileHash ? fileHash.substring(0, 12) : msgId.substring(0, 8)
    return `${safeName}_${suffix}.${ext}`
  }

  if (fileHash) return `hash_${fileHash}.${ext}`
  return `${msgId}.${ext}`
}

