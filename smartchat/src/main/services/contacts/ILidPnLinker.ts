export interface ILidPnLinker {
  linkLidAndPn(
    lid: string,
    pn: string,
    source?: string,
    isAlreadyLinked?: (lid: string, pn: string) => boolean,
    onLinked?: (lid: string, pn: string, identityId: number) => void
  ): Promise<void>
}
