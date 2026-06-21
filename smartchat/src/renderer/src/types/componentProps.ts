import { MessageItem } from './message.types'
import { RawMessageContent } from './mediaTypes'

export interface BaseMediaMessageProps {
  localURI?: string
  rawMsg?: RawMessageContent
  onDownload?: () => void
  isDownloading: boolean
}

export interface ImageMessageProps extends BaseMediaMessageProps {
  textContent?: string | null
  rawMsg: RawMessageContent
}

export interface StickerMessageProps extends BaseMediaMessageProps {
  rawMsg: RawMessageContent
}

export interface VideoMessageProps extends BaseMediaMessageProps {
  textContent?: string | null
  rawMsg: RawMessageContent
}

export interface DocumentMessageProps extends BaseMediaMessageProps {
  textContent?: string | null
  rawMsg: RawMessageContent
}

export interface TemplateMessageProps extends BaseMediaMessageProps {
  msg: MessageItem
  rawMsg: RawMessageContent
  onDownload: () => void
}

export interface AudioMessageProps extends BaseMediaMessageProps {
  textContent?: string | null
  senderJid?: string
  onDownload: () => void
}

export interface TextMessageProps {
  text: string
  mentions?: Record<string, string> | string[]
}
