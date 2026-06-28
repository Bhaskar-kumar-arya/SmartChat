import { ConnectionState } from '@whiskeysockets/baileys'
import { BaileysSocket } from './types'
import { WAEventHandler } from './WAEventHandler'

export interface ConnectionCallbacks {
  handleQr(qr: string): void
  handleConnectionClose(lastDisconnect: unknown): Promise<void>
  handleConnectionOpen(sock: BaileysSocket, syncFullHistory: boolean): Promise<void>
  handleConnectionUpdate(update: Partial<ConnectionState>): Promise<void>
}

export interface IWAEventWiringService {
  wire(
    sock: BaileysSocket,
    eventHandler: WAEventHandler,
    connectionCallbacks: ConnectionCallbacks,
    saveCreds: () => Promise<void>,
    syncFullHistory: boolean
  ): void
}
