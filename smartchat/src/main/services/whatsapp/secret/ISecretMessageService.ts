import { proto } from '@whiskeysockets/baileys'
import { ISecretMessageStrategy } from './ISecretMessageStrategy'
import { ProcessedMessage } from '../../../domain/db.types'
import { ProtocolResult } from '../types'
import { ISocketUserContext } from '../../contacts/IContactService'

export interface ISecretMessageService {
  registerStrategy(strategy: ISecretMessageStrategy): void
  
  handleSecretMessage(
    msg: proto.IWebMessageInfo,
    sock: ISocketUserContext | null
  ): Promise<ProcessedMessage | ProtocolResult | null>
}

