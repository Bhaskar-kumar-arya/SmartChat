import { PrismaClient } from '@prisma/client'
import { IWAEventBus } from '../../services/whatsapp/IWAEventBus'
import { WAEventHandler } from '../../services/whatsapp/WAEventHandler'
import { WorkerHistorySyncManager } from './services/WorkerHistorySyncManager'
import { AuthSettingsService } from '../../services/auth/AuthSettingsService'
import { ContactService } from '../../services/contacts/ContactService'
import { ChatService } from '../../services/chats/ChatService'
import { MessageService } from '../../services/messages/MessageService'
import { ReceiptService } from '../../services/whatsapp/ReceiptService'
import { WorkerFavoriteStickerService } from './services/WorkerFavoriteStickerService'
import { WorkerMediaService } from './services/WorkerMediaService'
import { ChatMemberRepository } from '../../services/chats/ChatMemberRepository'

export interface IWorkerBootstrap {
  eventBus: IWAEventBus
  eventHandler: WAEventHandler
  historySyncManager: WorkerHistorySyncManager
  authSettingsService: AuthSettingsService
  contactService: ContactService
  chatService: ChatService
  messageService: MessageService
  receiptService: ReceiptService
  favoriteStickerService: WorkerFavoriteStickerService
  mediaService: WorkerMediaService
  chatMemberRepository: ChatMemberRepository
  prisma: PrismaClient
}
