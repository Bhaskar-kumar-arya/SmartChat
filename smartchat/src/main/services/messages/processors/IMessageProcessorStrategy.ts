import { BaileysMessage, ProtocolResult, WAMessageContent } from '../../whatsapp/types'
import { ProcessedMessage } from '../../../domain/db.types'
import { IIdentityRepository } from '../../contacts/IIdentityRepository'
import { IMessageRepository } from '../IMessageRepository'
import { IReactionRepository } from '../IReactionRepository'
import { IMessageIndexer } from '../../search/IEmbeddingService'
import { SecretMessageService } from '../../whatsapp/secret/SecretMessageService'
import { ISocketUserContext, IContactNameResolver } from '../../contacts/IContactService'

export interface IMessageProcessingContext {
  msg: BaileysMessage
  sock: ISocketUserContext | null
  rawMessage: WAMessageContent | null | undefined
  unwrapped: WAMessageContent | null | undefined
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
  embeddingService: IMessageIndexer
  secretMessageService: SecretMessageService
  contactService: IContactNameResolver
}

export interface IMessageProcessorStrategy {
  readonly requiresChat?: boolean
  supports(context: IMessageProcessingContext): boolean
  process(
    context: IMessageProcessingContext,
    dependencies: IMessageServiceDependencyAccessor
  ): Promise<ProcessedMessage | ProtocolResult | null>
}
