import makeWASocket from '@whiskeysockets/baileys'
import { IWACommandSender } from '../../../workers/IWACommandSender'
import { ISocketUserContext } from '../../contacts/IContactService'

/** Type alias for the Baileys WhatsApp socket instance. */
export type BaileysSocket = ReturnType<typeof makeWASocket>

/** Type alias for the WhatsApp socket instance / worker bridge. */
export type WASocket = Omit<IWACommandSender, 'skipSync'> & ISocketUserContext

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
