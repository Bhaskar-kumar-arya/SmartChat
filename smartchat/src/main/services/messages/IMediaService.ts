import { ISocketUserContext } from '../contacts/IContactService'
import { EnrichedMessage } from '../../ipc/message.types'
import { Message } from '@prisma/client'

export interface IMediaSocket extends ISocketUserContext {
  updateMediaMessage?: (msg: any) => Promise<any>
}

export interface IMediaService {
  setFavoriteStickerQueuePaused(paused: boolean): void
  clearFavoriteStickerQueue(): void
  downloadFavoriteStickersFromSync(messages: Message[], sock: IMediaSocket | null): Promise<void>
  downloadAndCacheMedia(msgId: string, sock: IMediaSocket | null): Promise<EnrichedMessage>
  openFile(localURI: string): Promise<boolean>
}
