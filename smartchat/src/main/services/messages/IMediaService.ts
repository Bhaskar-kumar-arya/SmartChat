import { ISocketUserContext } from '../contacts/IContactService'
import { EnrichedMessage } from '../../ipc/message.types'

export interface IMediaSocket extends ISocketUserContext {
  updateMediaMessage?: (msg: any) => Promise<any>
}

/**
 * The minimal shape `downloadFavoriteStickersFromSync` needs from a synced
 * message. Deliberately not `@prisma/client`'s `Message` — the history-sync
 * pipeline passes freshly-parsed rows that are not full persisted `Message`
 * records. (P2-S4-06)
 */
export interface SyncStickerCandidate {
  id: string
  content: string
  messageType: string
}

export interface IMediaService {
  setFavoriteStickerQueuePaused(paused: boolean): void
  clearFavoriteStickerQueue(): void
  downloadFavoriteStickersFromSync(messages: SyncStickerCandidate[], sock: IMediaSocket | null): Promise<void>
  downloadAndCacheMedia(msgId: string, sock: IMediaSocket | null): Promise<EnrichedMessage>
  openFile(localURI: string): Promise<boolean>
}
