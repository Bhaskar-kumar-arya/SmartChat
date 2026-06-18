import { PrismaClient } from '@prisma/client'
import { BrowserWindow } from 'electron'
import { ContactService } from './services/contacts/ContactService'
import { LidPnLinker } from './services/contacts/LidPnLinker'
import { ContactNameResolver } from './services/contacts/ContactNameResolver'
import { IdentityReconciliationService } from './services/contacts/IdentityReconciliationService'
import { ProfileSyncService } from './services/contacts/ProfileSyncService'
import { EmbeddingService } from './services/search/EmbeddingService'
import { DataWipeService } from './services/DataWipeService'
import { ReceiptService } from './services/whatsapp/ReceiptService'
import { ChatService } from './services/chats/ChatService'
import { ChatListEnricher } from './services/chats/ChatListEnricher'
import { MessageService } from './services/messages/MessageService'
import { MessageParser } from './services/messages/MessageParser'
import { MessageEnricher } from './services/messages/MessageEnricher'
import { MessageActionService } from './services/messages/MessageActionService'
import { MediaService } from './services/messages/MediaService'
import { SearchService } from './services/search/SearchService'
import { AIService } from './services/ai/AIService'
import { AIChatSessionService } from './services/ai/AIChatSessionService'
import { AIChatExportService } from './services/ai/AIChatExportService'
import { NotificationService } from './services/notification/NotificationService'
import { SecretMessageService } from './services/whatsapp/secret/SecretMessageService'
import { MessageReactionStrategy } from './services/whatsapp/secret/MessageReactionStrategy'
import { FavoriteStickerService } from './services/messages/FavoriteStickerService'
import { GroupHydrationService } from './services/chats/GroupHydrationService'
import { CommunitySyncHandler } from './services/chats/sync/CommunitySyncHandler'
import { ChatSyncHandler } from './services/chats/sync/ChatSyncHandler'
import { MembershipSyncHandler } from './services/chats/sync/MembershipSyncHandler'

import { ContactRepository } from './services/contacts/ContactRepository'
import { IContactRepository } from './services/contacts/IContactRepository'
import { ChatRepository } from './services/chats/ChatRepository'
import { IChatRepository } from './services/chats/IChatRepository'
import { MessageRepository } from './services/messages/MessageRepository'
import { IMessageRepository } from './services/messages/IMessageRepository'
import { MessageQueryRepository } from './services/messages/MessageQueryRepository'
import { IMessageQueryRepository } from './services/messages/IMessageQueryRepository'
import { ReactionRepository } from './services/messages/ReactionRepository'
import { IReactionRepository } from './services/messages/IReactionRepository'
import { SyncRepository } from './services/sync/SyncRepository'
import { AuthStateRepository } from './services/auth/AuthStateRepository'
import { AuthSettingsService } from './services/auth/AuthSettingsService'

import type { WAEventBus } from './services/whatsapp/WAEventBus'
import { createMessageFormatterRegistry, MessageFormatterRegistry } from './services/messages/formatters'

import { HistorySyncManager } from './services/whatsapp/HistorySyncManager'
import { WAEventWiringService } from './services/whatsapp/WAEventWiringService'

export function createServices(
  prisma: PrismaClient,
  getMainWindow: () => BrowserWindow | null,
  getBus: () => WAEventBus | null
): ServiceContainer {
  const services = {} as unknown as ServiceContainer

  // 0. Formatting services
  const messageFormatterRegistry = createMessageFormatterRegistry()

  // Repositories
  const contactRepository = new ContactRepository(prisma)
  const chatRepository = new ChatRepository(prisma)
  const messageRepository = new MessageRepository(prisma)
  const messageQueryRepository = new MessageQueryRepository(prisma)
  const reactionRepository = new ReactionRepository(prisma)
  const syncRepository = new SyncRepository(prisma)
  const authStateRepository = new AuthStateRepository(prisma)
  const authSettingsService = new AuthSettingsService(authStateRepository)

  // 1. Foundation services (no service dependencies)
  const lidPnLinker = new LidPnLinker(contactRepository)
  const contactNameResolver = new ContactNameResolver(contactRepository)
  const contactService = new ContactService(contactRepository, lidPnLinker, contactNameResolver)
  const embeddingService = new EmbeddingService(prisma)
  const dataWipeService = new DataWipeService(prisma)
  const receiptService = new ReceiptService(prisma, contactService, getBus)
  const notificationService = new NotificationService(getMainWindow, messageFormatterRegistry)
  const secretMessageService = new SecretMessageService(prisma)
  secretMessageService.registerStrategy(new MessageReactionStrategy(getBus))
  const favoriteStickerService = new FavoriteStickerService(prisma)

  // 2. Services with service dependencies
  const chatListEnricher = new ChatListEnricher(chatRepository, messageQueryRepository, reactionRepository, contactService, messageFormatterRegistry)
  const chatService = new ChatService(chatRepository, contactService, chatListEnricher)
  const communitySyncHandler = new CommunitySyncHandler(syncRepository)
  const chatSyncHandler = new ChatSyncHandler(syncRepository)
  const membershipSyncHandler = new MembershipSyncHandler(syncRepository, contactService)
  const groupHydrationService = new GroupHydrationService(
    communitySyncHandler,
    chatSyncHandler,
    membershipSyncHandler
  )
  const messageParser = new MessageParser()
  const messageEnricher = new MessageEnricher(contactService)
  const messageService = new MessageService(
    contactService, contactRepository, chatRepository, embeddingService, secretMessageService, getBus,
    messageParser, messageRepository, messageQueryRepository, reactionRepository, messageEnricher
  )
  const messageActionService = new MessageActionService(
    messageRepository, reactionRepository, messageQueryRepository, contactRepository, contactService, messageService, chatService, getBus
  )
  const mediaService = new MediaService(
    messageRepository, messageQueryRepository, messageService, contactService, favoriteStickerService
  )
  const searchService = new SearchService(chatRepository, messageQueryRepository, contactRepository, contactService, embeddingService)
  const identityReconciliationService = new IdentityReconciliationService(prisma)
  const profileSyncService = new ProfileSyncService(prisma, contactService)

  // 3. AI services (unchanged internally — just re-exported/wired)
  const aiService = new AIService()
  const aiChatSessionService = new AIChatSessionService(prisma)
  const aiChatExportService = new AIChatExportService()

  // 4. WhatsApp Event Lifecycle & Sync Services
  const historySyncManager = new HistorySyncManager(services, getMainWindow, authSettingsService)
  const waEventWiringService = new WAEventWiringService(historySyncManager)

  Object.assign(services, {
    contactRepository,
    chatRepository,
    messageRepository,
    messageQueryRepository,
    reactionRepository,
    syncRepository,
    authSettingsService,
    contactService,
    embeddingService,
    dataWipeService,
    receiptService,
    chatService,
    groupHydrationService,
    messageService,
    messageActionService,
    mediaService,
    searchService,
    aiService,
    aiChatSessionService,
    aiChatExportService,
    notificationService,
    secretMessageService,
    favoriteStickerService,
    identityReconciliationService,
    profileSyncService,
    messageFormatterRegistry,
    historySyncManager,
    waEventWiringService
  })

  return services
}

export type ServiceContainer = {
  contactRepository: IContactRepository
  chatRepository: IChatRepository
  messageRepository: IMessageRepository
  messageQueryRepository: IMessageQueryRepository
  reactionRepository: IReactionRepository
  syncRepository: SyncRepository
  authSettingsService: AuthSettingsService
  contactService: ContactService
  embeddingService: EmbeddingService
  dataWipeService: DataWipeService
  receiptService: ReceiptService
  chatService: ChatService
  groupHydrationService: GroupHydrationService
  messageService: MessageService
  messageActionService: MessageActionService
  mediaService: MediaService
  searchService: SearchService
  aiService: AIService
  aiChatSessionService: AIChatSessionService
  aiChatExportService: AIChatExportService
  notificationService: NotificationService
  secretMessageService: SecretMessageService
  favoriteStickerService: FavoriteStickerService
  identityReconciliationService: IdentityReconciliationService
  profileSyncService: ProfileSyncService
  messageFormatterRegistry: MessageFormatterRegistry
  historySyncManager: HistorySyncManager
  waEventWiringService: WAEventWiringService
}
