import { ProcessedMessage } from '../../../domain/db.types'
import { ProtocolResult } from '../types'
import { ISocketUserContext } from '../../contacts/IContactService'

export interface SecretMessageContext {
  targetId: string
  remoteJid: string
  fromMe: boolean
  senderJid: string
  timestamp: bigint
}

export interface ISecretMessageStrategy {
  getSecretType(): number | string
  getSigningLabel(): string
  handle(
    decryptedBytes: Uint8Array,
    context: SecretMessageContext,
    sock: ISocketUserContext | null
  ): Promise<ProcessedMessage | ProtocolResult | null>
}

