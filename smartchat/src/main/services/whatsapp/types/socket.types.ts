import makeWASocket from '@whiskeysockets/baileys'

/** Type alias for the Baileys WhatsApp socket instance. */
export type WASocket = ReturnType<typeof makeWASocket>

/** Nullable socket accessor — used for lazy socket access. */
export type SocketAccessor = () => WASocket | null

/** Type-safe extension of WASocket for accessing private signalRepository */
export interface BaileysSignalRepository {
  lidMapping?: {
    getPNForLID?: (lid: string) => Promise<string | undefined>
  }
}

export interface WASocketWithSignalRepository {
  signalRepository?: BaileysSignalRepository
}
