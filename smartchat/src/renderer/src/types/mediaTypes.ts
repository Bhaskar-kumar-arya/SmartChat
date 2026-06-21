export interface JPEGThumbnailBuffer {
  type: 'Buffer'
  data: number[]
}

export type JPEGThumbnail = string | JPEGThumbnailBuffer | Uint8Array

export interface ContextInfo {
  quotedMessage?: RawMessageContent
  participant?: string
  participantName?: string
  mentions?: Record<string, string> | string[]
  stanzaId?: string
}

export interface ImageMessageContent {
  jpegThumbnail?: JPEGThumbnail
  width?: number
  height?: number
  fileLength?: number | string
  localURI?: string
  mimetype?: string
  caption?: string
  contextInfo?: ContextInfo
}

export interface VideoMessageContent {
  jpegThumbnail?: JPEGThumbnail
  width?: number
  height?: number
  fileLength?: number | string
  seconds?: number
  localURI?: string
  mimetype?: string
  gifPlayback?: boolean
  contextInfo?: ContextInfo
}

export interface DocumentMessageContent {
  fileName?: string
  fileLength?: number | string
  mimetype?: string
  localURI?: string
  contextInfo?: ContextInfo
}

export interface AudioMessageContent {
  seconds?: number
  mimetype?: string
  localURI?: string
  ptt?: boolean
  waveform?: Uint8Array | number[]
  contextInfo?: ContextInfo
}

export interface StickerMessageContent {
  localURI?: string
  mimetype?: string
  jpegThumbnail?: JPEGThumbnail
  contextInfo?: ContextInfo
}

export interface HydratedButton {
  quickReplyButton?: {
    displayText?: string
    id?: string
  }
  urlButton?: {
    displayText?: string
    url?: string
  }
  callButton?: {
    displayText?: string
    phoneNumber?: string
  }
}

export interface InteractiveButton {
  name: string
  buttonParamsJson?: string
}

export interface HydratedTemplate {
  hydratedContentText?: string
  hydratedFooterText?: string
  imageMessage?: ImageMessageContent
  videoMessage?: VideoMessageContent
  documentMessage?: DocumentMessageContent
  hydratedButtons?: HydratedButton[]
}

export interface InteractiveMessageTemplate {
  body?: {
    text?: string
  }
  footer?: {
    text?: string
  }
  header?: {
    title?: string
    text?: string
    imageMessage?: ImageMessageContent
    videoMessage?: VideoMessageContent
    documentMessage?: DocumentMessageContent
  }
  nativeFlowMessage?: {
    buttons?: InteractiveButton[]
  }
}

export interface TemplateMessageContent {
  hydratedFourRowTemplate?: HydratedTemplate
  hydratedTemplate?: HydratedTemplate
  interactiveMessageTemplate?: InteractiveMessageTemplate
}

export interface RawMessageContent {
  conversation?: string
  extendedTextMessage?: {
    text?: string
    contextInfo?: ContextInfo
  }
  imageMessage?: ImageMessageContent
  videoMessage?: VideoMessageContent
  ptvMessage?: VideoMessageContent
  documentMessage?: DocumentMessageContent
  audioMessage?: AudioMessageContent
  stickerMessage?: StickerMessageContent
  lottieStickerMessage?: unknown
  templateMessage?: TemplateMessageContent
  contextInfo?: ContextInfo
}

export function isJPEGThumbnailBuffer(thumb: unknown): thumb is JPEGThumbnailBuffer {
  return (
    typeof thumb === 'object' &&
    thumb !== null &&
    (thumb as Record<string, unknown>).type === 'Buffer' &&
    Array.isArray((thumb as Record<string, unknown>).data)
  )
}
