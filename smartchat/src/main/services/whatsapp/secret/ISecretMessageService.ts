import { proto, WASocket } from '@whiskeysockets/baileys'
import { ISecretMessageStrategy } from './ISecretMessageStrategy'
import { ProcessedMessage } from '../../../domain/db.types'
import { ProtocolResult } from '../types'

export interface ISecretMessageService {
  registerStrategy(strategy: ISecretMessageStrategy): void
  
  handleSecretMessage(
    msg: proto.IWebMessageInfo,
    sock: WASocket | null
  ): Promise<ProcessedMessage | ProtocolResult | null>
}
