import { proto } from '@whiskeysockets/baileys'
import { BaileysMessage, ProtocolResult, WASocket } from '../../whatsapp/types'
import { ProcessedMessage } from '../../../domain/db.types'
import { IIdentityRepository } from '../../contacts/IIdentityRepository'
import { IMessageRepository } from '../IMessageRepository'
import { IReactionRepository } from '../IReactionRepository'
import { IEmbeddingService } from '../../search/IEmbeddingService'
import { SecretMessageService } from '../../whatsapp/secret/SecretMessageService'

export interface IMessageProcessingContext {
  msg: BaileysMessage
  sock: WASocket | null
  rawMessage: proto.IMessage | null | undefined
  unwrapped: proto.IMessage | null | undefined
  remoteJid: string
  participantString: string | null
  senderId: number | null
  timestamp: bigint
  messageType: string
  textContent: string | null
}

export interface IMessageServiceDependencyAccessor {
  identityRepository: IIdentityRepository
  repository: IMessageRepository
  reactionRepository: IReactionRepository
  embeddingService: IEmbeddingService
  secretMessageService: SecretMessageService
}

export interface IMessageProcessorStrategy {
  readonly requiresChat?: boolean
  supports(context: IMessageProcessingContext): boolean
  process(
    context: IMessageProcessingContext,
    dependencies: IMessageServiceDependencyAccessor
  ): Promise<ProcessedMessage | ProtocolResult | null>
}
