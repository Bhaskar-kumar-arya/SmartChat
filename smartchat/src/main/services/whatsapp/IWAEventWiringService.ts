import { WASocket } from './types'
import { WAEventHandler } from './WAEventHandler'

export interface ConnectionCallbacks {
  handleQr(qr: string): void
  handleConnectionClose(lastDisconnect: any): Promise<void>
  handleConnectionOpen(sock: WASocket, syncFullHistory: boolean): Promise<void>
}

export interface IWAEventWiringService {
  wire(
    sock: WASocket,
    eventHandler: WAEventHandler,
    connectionCallbacks: ConnectionCallbacks,
    saveCreds: () => Promise<void>,
    syncFullHistory: boolean
  ): void
}
