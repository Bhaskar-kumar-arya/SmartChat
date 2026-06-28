import { PrismaClient } from '@prisma/client'
import { ChatRepository } from '../services/chats/ChatRepository'
import { CommunityRepository } from '../services/chats/CommunityRepository'
import { ChatMemberRepository } from '../services/chats/ChatMemberRepository'
import { IdentityRepository } from '../services/contacts/IdentityRepository'
import { AliasRepository } from '../services/contacts/AliasRepository'
import { LidMapRepository } from '../services/contacts/LidMapRepository'
import { MessageRepository } from '../services/messages/MessageRepository'
import { MessageQueryRepository } from '../services/messages/MessageQueryRepository'
import { ReceiptRepository } from '../services/messages/ReceiptRepository'
import { ReactionRepository } from '../services/messages/ReactionRepository'
import { SyncRepository } from '../services/sync/SyncRepository'
import { AuthStateRepository } from '../services/auth/AuthStateRepository'
import { AuthSettingsService } from '../services/auth/AuthSettingsService'

import { ContactCache } from '../services/contacts/ContactCache'
import { LidPnLinker } from '../services/contacts/LidPnLinker'
import { ContactNameResolver } from '../services/contacts/ContactNameResolver'
import { ContactService } from '../services/contacts/ContactService'

import {
  PnJidStrategy,
  LidJidStrategy,
  GroupJidStrategy,
  BotJidStrategy
} from '../services/contacts/JidStrategies'

import { GroupMembershipService } from '../services/chats/GroupMembershipService'
import { ChatService } from '../services/chats/ChatService'

import { CommunitySyncHandler } from '../services/chats/sync/CommunitySyncHandler'
import { ChatSyncHandler } from '../services/chats/sync/ChatSyncHandler'
import { MembershipSyncHandler } from '../services/chats/sync/MembershipSyncHandler'
import { GroupHydrationService } from '../services/chats/GroupHydrationService'
import { IdentityReconciliationService } from '../services/contacts/IdentityReconciliationService'

import { SecretMessageService } from '../services/whatsapp/secret/SecretMessageService'
import { MessageReactionStrategy } from '../services/whatsapp/secret/MessageReactionStrategy'
import { MessageParser } from '../services/messages/MessageParser'
import { MessageEnricher } from '../services/messages/MessageEnricher'
import { MessageIdentityResolver } from '../services/messages/MessageIdentityResolver'

import { SecretMessageProcessor } from '../services/messages/processors/SecretMessageProcessor'
import { ProtocolMessageProcessor } from '../services/messages/processors/ProtocolMessageProcessor'
import { ReactionMessageProcessor } from '../services/messages/processors/ReactionMessageProcessor'
import { StandardMessageProcessor } from '../services/messages/processors/StandardMessageProcessor'

import { MessageService } from '../services/messages/MessageService'
import { ReceiptService } from '../services/whatsapp/ReceiptService'
import { WAEventBus } from '../services/whatsapp/WAEventBus'
import { WAEventHandler } from '../services/whatsapp/WAEventHandler'

import { PersistenceSubscriber } from '../services/whatsapp/subscribers/PersistenceSubscriber'
import { ContactGroupSubscriber } from '../services/whatsapp/subscribers/ContactGroupSubscriber'
import { ReceiptSubscriber } from '../services/whatsapp/subscribers/ReceiptSubscriber'
import { FavoriteStickerSubscriber } from '../services/whatsapp/subscribers/FavoriteStickerSubscriber'

import {
  WorkerFavoriteStickerService,
  WorkerMediaService,
  WorkerHistorySyncManager
} from './WorkerServices'

export function bootstrapWorkerRepositories(
  prisma: PrismaClient,
  userDataPath: string,
  postDomainEvent: (event: string, data?: any) => void,
  getSock: () => any
) {
  // Event Bus
  const eventBus = new WAEventBus()
  const getBus = () => eventBus

  // Repositories
  const identityRepository = new IdentityRepository(prisma)
  const aliasRepository = new AliasRepository(prisma)
  const lidMapRepository = new LidMapRepository(prisma)

  const chatRepository = new ChatRepository(prisma)
  const communityRepository = new CommunityRepository(prisma)
  const chatMemberRepository = new ChatMemberRepository(prisma)

  const messageRepository = new MessageRepository(prisma)
  const messageQueryRepository = new MessageQueryRepository(prisma)
  const receiptRepository = new ReceiptRepository(prisma)
  const reactionRepository = new ReactionRepository(prisma)
  const syncRepository = new SyncRepository(prisma)
  const authStateRepository = new AuthStateRepository(prisma)
  const authSettingsService = new AuthSettingsService(authStateRepository)

  // Contacts Configuration
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

  // Chat/Group Services
  const groupMembershipService = new GroupMembershipService(chatMemberRepository, contactService)
  const chatService = new ChatService(
    chatRepository,
    communityRepository,
    contactService,
    groupMembershipService,
    null as any, // chatListEnricher is not needed by the worker's write paths
    getSock
  )

  // Worker-specific Favorite Stickers and Media Services
  const favoriteStickerService = new WorkerFavoriteStickerService(prisma, userDataPath)
  
  const messageParser = new MessageParser()
  const messageEnricher = new MessageEnricher(contactService)
  
  const mediaService = new WorkerMediaService(
    messageRepository,
    messageQueryRepository,
    null as any, // messageService reference is set dynamically below
    null as any, // messageParserService reference is set dynamically below
    contactNameResolver,
    favoriteStickerService,
    userDataPath
  )

  // Embedding / Indexing Dummy Service for Worker
  const dummyEmbeddingService = {
    indexMessage: async () => {},
    indexAll: async () => {},
    clearAllVectors: async () => {},
    setPaused: () => {},
    setOnActiveStateSync: () => {}
  }

  // Identity Reconciliation
  const identityReconciliationService = new IdentityReconciliationService(prisma, contactService)

  // Message Service Processors
  const secretMessageService = new SecretMessageService(prisma)
  secretMessageService.registerStrategy(new MessageReactionStrategy(getBus))

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
    dummyEmbeddingService,
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

  // Resolve circular reference on mediaService
  ;(mediaService as any).messageService = messageService
  ;(mediaService as any).messageParserService = messageService

  // Receipt Service
  const receiptService = new ReceiptService(
    receiptRepository,
    contactService,
    getBus
  )

  // Sync / Hydration Orchestration
  const communitySyncHandler = new CommunitySyncHandler(syncRepository)
  const chatSyncHandler = new ChatSyncHandler(syncRepository)
  const membershipSyncHandler = new MembershipSyncHandler(syncRepository, contactService)

  const groupHydrationService = new GroupHydrationService(
    communitySyncHandler,
    chatSyncHandler,
    membershipSyncHandler
  )

  const historySyncManager = new WorkerHistorySyncManager(
    {
      mediaService,
      embeddingService: dummyEmbeddingService,
      contactService,
      aliasRepository,
      chatRepository,
      communityRepository,
      messageRepository,
      reactionRepository,
      groupHydrationService,
      identityReconciliationService
    },
    authSettingsService,
    postDomainEvent
  )

  // Event Handler
  const eventHandler = new WAEventHandler(
    messageService,
    messageService,
    eventBus
  )

  // Register Subscribers
  const subscribers = [
    new PersistenceSubscriber(messageService, chatService),
    new ContactGroupSubscriber(contactService, chatService, groupMembershipService, chatMemberRepository),
    new ReceiptSubscriber(receiptService, messageService, contactService),
    new FavoriteStickerSubscriber(favoriteStickerService)
  ]

  subscribers.forEach(sub => sub.register(eventBus))

  return {
    eventBus,
    eventHandler,
    historySyncManager,
    authSettingsService,
    contactService,
    chatService,
    messageService,
    receiptService,
    favoriteStickerService,
    mediaService,
    chatMemberRepository,
    prisma
  }
}
