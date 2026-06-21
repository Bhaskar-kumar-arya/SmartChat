import { proto } from '@whiskeysockets/baileys'

/** Options for sending media via WhatsApp. */
export interface MediaSendOptions {
  image?: Buffer; video?: Buffer; audio?: Buffer; document?: Buffer; sticker?: Buffer
  caption?: string; fileName?: string; mimetype?: string; ptt?: boolean
  mentions?: string[]
  gifPlayback?: boolean
  contextInfo?: proto.IContextInfo
}
