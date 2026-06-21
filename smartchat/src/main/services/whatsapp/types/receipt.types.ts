import { WAMessageKey } from '../../../domain/whatsapp.types'

/** Payload shape for message status receipt updates. */
export interface MessageReceiptUpdate {
  key: WAMessageKey
  receipt: {
    userJid?: string | null
    readTimestamp?: unknown
    receiptTimestamp?: unknown
    deliveredTimestamp?: unknown
  }
}
