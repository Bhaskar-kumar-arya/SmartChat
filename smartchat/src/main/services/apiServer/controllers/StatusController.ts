import http from 'http'
import { WASocket } from '../../whatsapp/types'
import { sendJSON } from './helpers'

export class StatusController {
  constructor(private readonly getSock: () => WASocket | null, private readonly port: number) {}

  getStatus = (_req: http.IncomingMessage, res: http.ServerResponse): void => {
    const sockConnected = this.getSock() !== null
    sendJSON(res, 200, {
      status: 'running',
      port: this.port,
      whatsappConnected: sockConnected
    })
  }
}
