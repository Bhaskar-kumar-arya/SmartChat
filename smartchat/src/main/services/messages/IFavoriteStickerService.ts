export interface FavoriteStickerDTO {
  id: string
  fileSha256: string
  fileName: string
  localURI: string
  createdAt: number
}

export interface IFavoriteStickerService {
  addStickerToFavorites(msgId: string): Promise<boolean>
  
  removeStickerFromFavorites(msgId: string): Promise<boolean>
  
  removeFavoriteStickerById(id: string): Promise<boolean>
  
  removeFavoriteStickerBySha(fileSha256: string): Promise<boolean>
  
  isStickerFavorite(msgId: string): Promise<boolean>
  
  getFavoriteStickers(): Promise<FavoriteStickerDTO[]>
  
  syncFavoriteSticker(
    fileSha256: string,
    stickerAction: Record<string, unknown> & { mediaKey?: unknown; fileSha256?: unknown },
    sock: unknown
  ): Promise<boolean>
  
  handleDownloadedSticker(fileSha256: string, sourcePath: string): Promise<void>
  
  findFavoritesByHashes(hashes: string[]): Promise<Array<{ fileSha256: string; fileName: string }>>
}
