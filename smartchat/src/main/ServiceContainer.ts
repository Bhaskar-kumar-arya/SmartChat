import { PrismaClient } from '@prisma/client'
import { BrowserWindow, app } from 'electron'
import path from 'path'
import { ContactService } from './services/contacts/ContactService'
import { IContactService } from './services/contacts/IContactService'
import { LidPnLinker } from './services/contacts/LidPnLinker'
import { ContactNameResolver } from './services/contacts/ContactNameResolver'
import { ContactCache } from './services/contacts/ContactCache'
import { PnJidStrategy, LidJidStrategy, GroupJidStrategy, BotJidStrategy } from './services/contacts/JidStrategies'
import { IdentityReconciliationService } from './services/contacts/IdentityReconciliationService'
import { IIdentityReconciliationService } from './services/contacts/IIdentityReconciliationService'
import { ProfileSyncService } from './services/contacts/ProfileSyncService'
import { IProfileSyncService } from './services/contacts/IProfileSyncService'
import { EmbeddingService } from './services/search/EmbeddingService'
import { IEmbeddingService } from './services/search/IEmbeddingService'
import { IVectorSyncService } from './services/search/IVectorSyncService'
import { VectorSyncService } from './services/search/VectorSyncService'
import { EmbeddingWorkerManager } from './services/search/EmbeddingWorkerManager'
import { DataWipeService } from './services/DataWipeService'
import { IDataWipeService } from './services/IDataWipeService'
import { ReceiptService } from './services/whatsapp/ReceiptService'
import { IReceiptService } from './services/whatsapp/IReceiptService'
import { ChatService } from './services/chats/ChatService'
import { IChatService } from './services/chats/IChatService'
import { GroupMembershipService } from './services/chats/GroupMembershipService'
import { IGroupMembershipService } from './services/chats/IGroupMembershipService'
import { ChatListEnricher } from './services/chats/ChatListEnricher'
import { MessageService } from './services/messages/MessageService'
import { IMessageWriterService } from './services/messages/IMessageWriterService'
import { IMessageQueryService } from './services/messages/IMessageQueryService'
import { IMessageParserService } from './services/messages/IMessageParserService'
import { IMessageProcessingService } from './services/messages/IMessageProcessingService'
import { MessageParser } from './services/messages/MessageParser'
import { MessageEnricher } from './services/messages/MessageEnricher'
import { MessageActionService } from './services/messages/MessageActionService'
import { IMessageActionService } from './services/messages/IMessageActionService'
import { MessageSenderService } from './services/messages/MessageSenderService'
import { IMessageSenderService } from './services/messages/IMessageSenderService'
import { MediaService } from './services/messages/MediaService'
import { IMediaService } from './services/messages/IMediaService'
import { MessageIdentityResolver } from './services/messages/MessageIdentityResolver'
import {
  SecretMessageProcessor,
  ProtocolMessageProcessor,
  ReactionMessageProcessor,
  StandardMessageProcessor
} from './services/messages/processors'
import { SearchService } from './services/search/SearchService'
import { ISearchService } from './services/search/ISearchService'
import { AIService } from './services/ai/AIService'
import { IAIService } from './services/ai/IAIService'
import { AIChatSessionService } from './services/ai/AIChatSessionService'
import { IAIChatSessionService } from './services/ai/IAIChatSessionService'
import { AIChatExportService } from './services/ai/AIChatExportService'
import { IAIChatExportService } from './services/ai/IAIChatExportService'
import { NotificationService } from './services/notification/NotificationService'
import { INotificationService } from './services/notification/INotificationService'
import { SecretMessageService } from './services/whatsapp/secret/SecretMessageService'
import { ISecretMessageService } from './services/whatsapp/secret/ISecretMessageService'
import { MessageReactionStrategy } from './services/whatsapp/secret/MessageReactionStrategy'
import { FavoriteStickerService } from './services/messages/FavoriteStickerService'
import { IFavoriteStickerService } from './services/messages/IFavoriteStickerService'
import { GroupHydrationService } from './services/chats/GroupHydrationService'
import { IGroupHydrationService } from './services/chats/IGroupHydrationService'
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
import { IRawSqlExecutor } from './services/messages/IRawSqlExecutor'
import { MessageVectorRepository } from './services/messages/MessageVectorRepository'
import { IMessageVectorRepository } from './services/messages/IMessageVectorRepository'

import { ReactionRepository } from './services/messages/ReactionRepository'
import { IReactionRepository } from './services/messages/IReactionRepository'
import { SyncRepository } from './services/sync/SyncRepository'
import { ISyncRepository } from './services/sync/ISyncRepository'
import { AuthStateRepository } from './services/auth/AuthStateRepository'
import { AuthSettingsService } from './services/auth/AuthSettingsService'
import { IAuthSettingsService } from './services/auth/IAuthSettingsService'
import { CallRepository } from './services/calls/CallRepository'
import { CallService } from './services/calls/CallService'
import { ICallQueryService, ICallMutationService } from './services/calls/ICallService'

import type { IWAEventBus } from './services/whatsapp/IWAEventBus'
import { createMessageFormatterRegistry, MessageFormatterRegistry } from './services/messages/formatters'

import { SocketAccessor } from './services/whatsapp/types'
import { WAWorkerBridge } from './workers/bridge/WAWorkerBridge'
import { IWindowEventEmitter } from './workers/bridge/IWindowEventEmitter'
import { dbPath } from './auth'
import { HistorySyncManager } from './services/whatsapp/HistorySyncManager'
import { IHistorySyncManager } from './services/whatsapp/IHistorySyncManager'
import { WAEventWiringService } from './services/whatsapp/WAEventWiringService'
import { IWAEventWiringService } from './services/whatsapp/IWAEventWiringService'
import { IWASocketFactory } from './services/whatsapp/IWASocketFactory'
import { WASocketFactory } from './services/whatsapp/WASocketFactory'
import { IWACatchUpManager } from './services/whatsapp/IWACatchUpManager'
import { WACatchUpManager } from './services/whatsapp/WACatchUpManager'

import { IKeyStorage } from './services/ai/IKeyStorage'
import { FSKeyStorage } from './services/ai/FSKeyStorage'
import { IAIKeyService } from './services/ai/IAIKeyService'
import { AIKeyService } from './services/ai/AIKeyService'
import { IReceiptRepository } from './services/messages/IReceiptRepository'
import { ReceiptRepository } from './services/messages/ReceiptRepository'
import { IToolRegistry } from './services/ai/IToolRegistry'
import { ToolRegistry } from './services/ai/AIToolService'
import { ISystemInstructionBuilder } from './services/ai/ISystemInstructionBuilder'
import { SystemPromptBuilder } from './services/ai/SystemPromptBuilder'
import { ReactProtocolStrategy } from './services/ai/prompts/ReactProtocolStrategy'
import { StandardProtocolStrategy } from './services/ai/prompts/StandardProtocolStrategy'
import { APIServer } from './services/apiServer/APIServer'
import { IAPIServer } from './services/apiServer/IAPIServer'
import { APIConfigProvider } from './services/apiServer/APIConfigProvider'
import { IAPIConfigProvider } from './services/apiServer/IAPIConfigProvider'



class ElectronWindowEmitter implements IWindowEventEmitter {
  constructor(private readonly getMainWindow: () => BrowserWindow | null) {}

  public send(channel: string, data?: unknown): void {
    const mainWindow = this.getMainWindow()
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send(channel, data)
    }
  }
}

export function createServices(
  prisma: PrismaClient,
  getMainWindow: () => BrowserWindow | null,
  getBus: () => IWAEventBus | null,
  getSock: SocketAccessor
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
  const callRepository = new CallRepository(prisma)

  // AI Key Storage & Service
  const keyStorage: IKeyStorage = new FSKeyStorage()
  const aiKeyService = new AIKeyService(keyStorage)

  // 1. Foundation services (no service dependencies)
  const strategies = [
    new PnJidStrategy(),
    new LidJidStrategy(),
    new GroupJidStrategy(),
    new BotJidStrategy()
  ]
  const contactCache = new ContactCache()
  const lidPnLinker = new LidPnLinker(identityRepository, aliasRepository, lidMapRepository)
  const contactNameResolver = new ContactNameResolver(
    aliasRepository,
    (sock) => contactService.getMeJids(sock),
    (lid, pn, src) => contactService.linkLidAndPn(lid, pn, src)
  )
  const contactService = new ContactService(
    identityRepository,
    aliasRepository,
    lidMapRepository,
    lidPnLinker,
    contactNameResolver,
    contactCache,
    strategies
  )
  const identityReconciliationService = new IdentityReconciliationService(prisma, contactService)
  const groupMembershipService = new GroupMembershipService(chatMemberRepository, contactService)
  const embeddingWorkerManager = new EmbeddingWorkerManager({
    workerPath: path.join(__dirname, 'embedding.worker.js'),
    modelCacheDir: path.join(app.getPath('userData'), 'models'),
    localModelsRoot: path.join(app.getAppPath(), 'src', 'main', 'models')
  })
  const embeddingService = new EmbeddingService(
    messageVectorRepository,
    messageQueryRepository,
    embeddingWorkerManager
  )
  const vectorSyncService = new VectorSyncService(messageVectorRepository)
  const dataWipeService = new DataWipeService(prisma)
  const receiptService = new ReceiptService(receiptRepository, contactService, getBus)
  const notificationService = new NotificationService(getMainWindow, messageFormatterRegistry)
  const secretMessageService = new SecretMessageService(prisma)
  secretMessageService.registerStrategy(new MessageReactionStrategy(getBus))
  const favoriteStickerService = new FavoriteStickerService(prisma)
  const callService = new CallService(callRepository)

  // 2. Services with service dependencies
  const chatListEnricher = new ChatListEnricher(chatRepository, messageQueryRepository, reactionRepository, contactService, messageFormatterRegistry)
  const chatService = new ChatService(chatRepository, communityRepository, contactService, groupMembershipService, chatListEnricher, getSock)
  const communitySyncHandler = new CommunitySyncHandler(syncRepository)
  const chatSyncHandler = new ChatSyncHandler(syncRepository)
  const membershipSyncHandler = new MembershipSyncHandler(syncRepository, contactService)
  const groupHydrationService = new GroupHydrationService(
    communitySyncHandler,
    chatSyncHandler,
    membershipSyncHandler
  )
  const messageParser = new MessageParser()
  const messageEnricher = new MessageEnricher(contactService, callService)
  const messageIdentityResolver = new MessageIdentityResolver(
    contactService,
    identityRepository,
    identityReconciliationService
  )
  const messageProcessors = [
    new SecretMessageProcessor(),
    new ProtocolMessageProcessor(),
    new ReactionMessageProcessor(),
    new StandardMessageProcessor()
  ]
  const messageService = new MessageService(
    contactService,
    chatRepository,
    embeddingService,
    secretMessageService,
    getBus,
    messageParser,
    messageRepository,
    messageQueryRepository,
    reactionRepository,
    messageEnricher,
    messageIdentityResolver,
    messageProcessors
  )
  const messageSenderService = new MessageSenderService(
    messageRepository,
    messageQueryRepository,
    contactService,
    messageService,
    messageService,
    messageService,
    chatService,
    getBus
  )
  const messageActionService = new MessageActionService(
    messageRepository, reactionRepository, messageQueryRepository, identityRepository, contactService, messageService, messageService, chatService, getBus, messageSenderService
  )
  const mediaService = new MediaService(
    messageRepository, messageQueryRepository, messageService, messageService, contactService, favoriteStickerService
  )
  const searchService = new SearchService(chatRepository, messageQueryRepository, messageVectorRepository, identityRepository, contactService, embeddingService)
  const profileSyncService = new ProfileSyncService(identityRepository, chatRepository, contactService)

  // 3. AI services
  const reactStrategy = new ReactProtocolStrategy()
  const standardStrategy = new StandardProtocolStrategy()
  const promptBuilder = new SystemPromptBuilder(reactStrategy, standardStrategy)
  const toolRegistry: IToolRegistry & ISystemInstructionBuilder = new ToolRegistry(promptBuilder)
  const aiService = new AIService(aiKeyService, contactService, toolRegistry)
  const aiChatSessionService = new AIChatSessionService(prisma)
  const aiChatExportService = new AIChatExportService()
  const apiConfigProvider: IAPIConfigProvider = new APIConfigProvider(app.getPath('userData'))
  const apiServer = new APIServer(
    apiConfigProvider,
    toolRegistry,
    chatService,
    messageActionService,
    getSock
  )



  // 4. WhatsApp Event Lifecycle & Sync Services
  const workerPath = path.join(__dirname, 'whatsapp.worker.js')
  const userDataPath = app.getPath('userData')
  const windowEmitter = new ElectronWindowEmitter(getMainWindow)
  const waWorkerBridge = new WAWorkerBridge(
    workerPath,
    dbPath,
    userDataPath,
    getBus,
    windowEmitter
  )
  const socketFactory: IWASocketFactory = new WASocketFactory(messageQueryRepository)
  const catchUpManager: IWACatchUpManager = new WACatchUpManager(embeddingService, authSettingsService)
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
    vectorSyncService,
    dataWipeService,
    receiptService,
    chatService,
    groupHydrationService,
    messageWriterService: messageService,
    messageQueryService: messageService,
    messageProcessingService: messageService,
    messageParserService: messageService,
    messageActionService,
    messageSenderService,
    mediaService,
    searchService,
    toolRegistry,
    aiService,
    aiChatSessionService,
    aiChatExportService,
    notificationService,
    secretMessageService,
    favoriteStickerService,
    identityReconciliationService,
    profileSyncService,
    messageFormatterRegistry,
    waWorkerBridge,
    aiKeyService,
    historySyncManager,
    waEventWiringService,
    socketFactory,
    catchUpManager,
    apiServer,
    callService
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
  messageQueryRepository: IMessageQueryRepository & IRawSqlExecutor
  messageVectorRepository: IMessageVectorRepository
  receiptRepository: IReceiptRepository
  reactionRepository: IReactionRepository
  syncRepository: ISyncRepository
  authSettingsService: IAuthSettingsService
  contactService: IContactService
  groupMembershipService: IGroupMembershipService
  embeddingService: IEmbeddingService
  vectorSyncService: IVectorSyncService
  dataWipeService: IDataWipeService
  receiptService: IReceiptService
  chatService: IChatService
  groupHydrationService: IGroupHydrationService
  messageWriterService: IMessageWriterService
  messageQueryService: IMessageQueryService
  messageProcessingService: IMessageProcessingService
  messageParserService: IMessageParserService
  messageActionService: IMessageActionService
  messageSenderService: IMessageSenderService
  mediaService: IMediaService
  searchService: ISearchService
  toolRegistry: IToolRegistry
  aiService: IAIService
  aiChatSessionService: IAIChatSessionService
  aiChatExportService: IAIChatExportService
  notificationService: INotificationService
  secretMessageService: ISecretMessageService
  favoriteStickerService: IFavoriteStickerService
  identityReconciliationService: IIdentityReconciliationService
  profileSyncService: IProfileSyncService
  messageFormatterRegistry: MessageFormatterRegistry
  waWorkerBridge: WAWorkerBridge
  aiKeyService: IAIKeyService
  historySyncManager: IHistorySyncManager
  waEventWiringService: IWAEventWiringService
  socketFactory: IWASocketFactory
  catchUpManager: IWACatchUpManager
  apiServer: IAPIServer
  callService: ICallQueryService & ICallMutationService
}

