import { PrismaClient } from '@prisma/client'
import { BrowserWindow } from 'electron'
import { ContactService } from './services/contacts/ContactService'
import { IContactService } from './services/contacts/IContactService'
import { LidPnLinker } from './services/contacts/LidPnLinker'
import { ContactNameResolver } from './services/contacts/ContactNameResolver'
import { IdentityReconciliationService } from './services/contacts/IdentityReconciliationService'
import { ProfileSyncService } from './services/contacts/ProfileSyncService'
import { EmbeddingService, IEmbeddingService } from './services/search/EmbeddingService'
import { DataWipeService } from './services/DataWipeService'
import { ReceiptService } from './services/whatsapp/ReceiptService'
import { IReceiptService } from './services/whatsapp/IReceiptService'
import { ChatService } from './services/chats/ChatService'
import { IChatService } from './services/chats/IChatService'
import { GroupMembershipService } from './services/chats/GroupMembershipService'
import { IGroupMembershipService } from './services/chats/IGroupMembershipService'
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

import { IdentityRepository } from './services/contacts/IdentityRepository'
import { IIdentityRepository } from './services/contacts/IIdentityRepository'
import { AliasRepository } from './services/contacts/AliasRepository'
import { IAliasRepository } from './services/contacts/IAliasRepository'
import { LidMapRepository } from './services/contacts/LidMapRepository'
import { ILidMapRepository } from './services/contacts/ILidMapRepository'

import { ChatRepository } from './services/chats/ChatRepository'
import { IChatRepository } from './services/chats/IChatRepository'
import { CommunityRepository } from './services/chats/CommunityRepository'
import { ICommunityRepository } from './services/chats/ICommunityRepository'
import { ChatMemberRepository } from './services/chats/ChatMemberRepository'
import { IChatMemberRepository } from './services/chats/IChatMemberRepository'

import { MessageRepository } from './services/messages/MessageRepository'
import { IMessageRepository } from './services/messages/IMessageRepository'
import { MessageQueryRepository } from './services/messages/MessageQueryRepository'
import { IMessageQueryRepository } from './services/messages/IMessageQueryRepository'
import { MessageVectorRepository } from './services/messages/MessageVectorRepository'
import { IMessageVectorRepository } from './services/messages/IMessageVectorRepository'

import { ReactionRepository } from './services/messages/ReactionRepository'
import { IReactionRepository } from './services/messages/IReactionRepository'
import { SyncRepository } from './services/sync/SyncRepository'
import { AuthStateRepository } from './services/auth/AuthStateRepository'
import { AuthSettingsService } from './services/auth/AuthSettingsService'

import type { IWAEventBus } from './services/whatsapp/IWAEventBus'
import { createMessageFormatterRegistry, MessageFormatterRegistry } from './services/messages/formatters'

import { HistorySyncManager } from './services/whatsapp/HistorySyncManager'
import { WAEventWiringService } from './services/whatsapp/WAEventWiringService'

import { IKeyStorage } from './services/ai/IKeyStorage'
import { FSKeyStorage } from './services/ai/FSKeyStorage'
import { IAIKeyService } from './services/ai/IAIKeyService'
import { AIKeyService } from './services/ai/AIKeyService'
import { IReceiptRepository } from './services/messages/IReceiptRepository'
import { ReceiptRepository } from './services/messages/ReceiptRepository'

export function createServices(
  prisma: PrismaClient,
  getMainWindow: () => BrowserWindow | null,
  getBus: () => IWAEventBus | null
): ServiceContainer {
  const services = {} as unknown as ServiceContainer

  // 0. Formatting services
  const messageFormatterRegistry = createMessageFormatterRegistry()

  // Repositories
  const identityRepository = new IdentityRepository(prisma)
  const aliasRepository = new AliasRepository(prisma)
  const lidMapRepository = new LidMapRepository(prisma)

  const chatRepository = new ChatRepository(prisma)
  const communityRepository = new CommunityRepository(prisma)
  const chatMemberRepository = new ChatMemberRepository(prisma)

  const messageRepository = new MessageRepository(prisma)
  const messageQueryRepository = new MessageQueryRepository(prisma)
  const messageVectorRepository = new MessageVectorRepository(prisma)
  const receiptRepository = new ReceiptRepository(prisma)
  const reactionRepository = new ReactionRepository(prisma)
  const syncRepository = new SyncRepository(prisma)
  const authStateRepository = new AuthStateRepository(prisma)
  const authSettingsService = new AuthSettingsService(authStateRepository)

  // AI Key Storage & Service
  const keyStorage: IKeyStorage = new FSKeyStorage()
  const aiKeyService = new AIKeyService(keyStorage)

  // 1. Foundation services (no service dependencies)
  const lidPnLinker = new LidPnLinker(identityRepository, aliasRepository, lidMapRepository)
  const contactNameResolver = new ContactNameResolver(aliasRepository)
  const contactService = new ContactService(identityRepository, aliasRepository, lidMapRepository, lidPnLinker, contactNameResolver)
  const groupMembershipService = new GroupMembershipService(chatMemberRepository, contactService)
  const embeddingService = new EmbeddingService(messageVectorRepository, messageQueryRepository)
  const dataWipeService = new DataWipeService(prisma)
  const receiptService = new ReceiptService(receiptRepository, contactService, getBus)
  const notificationService = new NotificationService(getMainWindow, messageFormatterRegistry)
  const secretMessageService = new SecretMessageService(prisma)
  secretMessageService.registerStrategy(new MessageReactionStrategy(getBus))
  const favoriteStickerService = new FavoriteStickerService(prisma)

  // 2. Services with service dependencies
  const chatListEnricher = new ChatListEnricher(chatRepository, messageQueryRepository, reactionRepository, contactService, messageFormatterRegistry)
  const chatService = new ChatService(chatRepository, communityRepository, contactService, groupMembershipService, chatListEnricher)
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
    contactService, identityRepository, chatRepository, embeddingService, secretMessageService, getBus,
    messageParser, messageRepository, messageQueryRepository, reactionRepository, messageEnricher
  )
  const messageActionService = new MessageActionService(
    messageRepository, reactionRepository, messageQueryRepository, identityRepository, contactService, messageService, chatService, getBus
  )
  const mediaService = new MediaService(
    messageRepository, messageQueryRepository, messageService, contactService, favoriteStickerService
  )
  const searchService = new SearchService(chatRepository, messageQueryRepository, messageVectorRepository, identityRepository, contactService, embeddingService)
  const identityReconciliationService = new IdentityReconciliationService(prisma)
  const profileSyncService = new ProfileSyncService(prisma, contactService)

  // 3. AI services
  const aiService = new AIService(aiKeyService, contactService)
  const aiChatSessionService = new AIChatSessionService(prisma)
  const aiChatExportService = new AIChatExportService()

  // 4. WhatsApp Event Lifecycle & Sync Services
  const historySyncManager = new HistorySyncManager(services, getMainWindow, authSettingsService)
  const waEventWiringService = new WAEventWiringService(historySyncManager)

  Object.assign(services, {
    identityRepository,
    aliasRepository,
    lidMapRepository,
    chatRepository,
    communityRepository,
    chatMemberRepository,
    messageRepository,
    messageQueryRepository,
    messageVectorRepository,
    receiptRepository,
    reactionRepository,
    syncRepository,
    authSettingsService,
    contactService,
    groupMembershipService,
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
    waEventWiringService,
    aiKeyService
  })

  return services
}

export type ServiceContainer = {
  identityRepository: IIdentityRepository
  aliasRepository: IAliasRepository
  lidMapRepository: ILidMapRepository
  chatRepository: IChatRepository
  communityRepository: ICommunityRepository
  chatMemberRepository: IChatMemberRepository
  messageRepository: IMessageRepository
  messageQueryRepository: IMessageQueryRepository
  messageVectorRepository: IMessageVectorRepository
  receiptRepository: IReceiptRepository
  reactionRepository: IReactionRepository
  syncRepository: SyncRepository
  authSettingsService: AuthSettingsService
  contactService: IContactService
  groupMembershipService: IGroupMembershipService
  embeddingService: IEmbeddingService
  dataWipeService: DataWipeService
  receiptService: IReceiptService
  chatService: IChatService
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
  aiKeyService: IAIKeyService
}
