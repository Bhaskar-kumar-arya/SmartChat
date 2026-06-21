import { WASocket } from '../whatsapp/types'
import { EnrichedMessage } from '../../ipc/message.types'
import { Message } from '@prisma/client'

export interface IMediaService {
  setFavoriteStickerQueuePaused(paused: boolean): void
  clearFavoriteStickerQueue(): void
  downloadFavoriteStickersFromSync(messages: Message[], sock: WASocket | null): Promise<void>
  downloadAndCacheMedia(msgId: string, sock: WASocket | null): Promise<EnrichedMessage>
  openFile(localURI: string): Promise<boolean>
}
