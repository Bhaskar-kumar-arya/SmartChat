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
export function resolveExtension(mediaType: string, mediaMsg: any): string {
  if (mediaType === 'image') return 'jpg'
  if (mediaType === 'sticker') return 'webp'
  if (mediaType === 'video') return 'mp4'
  if (mediaType === 'audio') return 'ogg'
  
  if (mediaType === 'document') {
      const mime = mediaMsg.mimetype || ''
      if (mime.includes('pdf')) return 'pdf'
      if (mime.includes('word')) return 'docx'
      if (mime.includes('sheet')) return 'xlsx'
      if (mime.includes('text')) return 'txt'
      
      const originalName = mediaMsg.fileName || ''
      if (originalName.includes('.')) return originalName.split('.').pop() || 'dat'
  }
  
  return 'dat'
}
