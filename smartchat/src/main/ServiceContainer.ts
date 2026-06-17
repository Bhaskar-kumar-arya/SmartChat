import { PrismaClient } from '@prisma/client'
import { BrowserWindow } from 'electron'
import { ContactService } from './services/contacts/ContactService'
import { IdentityReconciliationService } from './services/contacts/IdentityReconciliationService'
import { ProfileSyncService } from './services/contacts/ProfileSyncService'
import { EmbeddingService } from './services/search/EmbeddingService'
import { DataWipeService } from './services/DataWipeService'
import { ReceiptService } from './services/whatsapp/ReceiptService'
import { ChatService } from './services/chats/ChatService'
import { MessageService } from './services/messages/MessageService'
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

import type { WAEventBus } from './services/whatsapp/WAEventBus'
import { MessageFormatterRegistry } from './services/messages/formatters/MessageFormatterRegistry'
import { ConversationFormatter } from './services/messages/formatters/ConversationFormatter'
import { ImageFormatter } from './services/messages/formatters/ImageFormatter'
import { VideoFormatter } from './services/messages/formatters/VideoFormatter'
import { StickerFormatter } from './services/messages/formatters/StickerFormatter'
import { DocumentFormatter } from './services/messages/formatters/DocumentFormatter'
import { AudioFormatter } from './services/messages/formatters/AudioFormatter'
import { ContactFormatter } from './services/messages/formatters/ContactFormatter'
import { LocationFormatter } from './services/messages/formatters/LocationFormatter'
import { PollFormatter } from './services/messages/formatters/PollFormatter'
import { ReactionFormatter } from './services/messages/formatters/ReactionFormatter'

export function createServices(
  prisma: PrismaClient,
  getMainWindow: () => BrowserWindow | null,
  getBus: () => WAEventBus | null
) {
  // 0. Formatting services
  const messageFormatterRegistry = new MessageFormatterRegistry()
  messageFormatterRegistry.registerFormatter(new ConversationFormatter())
  messageFormatterRegistry.registerFormatter(new ImageFormatter())
  messageFormatterRegistry.registerFormatter(new VideoFormatter())
  messageFormatterRegistry.registerFormatter(new StickerFormatter())
  messageFormatterRegistry.registerFormatter(new DocumentFormatter())
  messageFormatterRegistry.registerFormatter(new AudioFormatter())
  messageFormatterRegistry.registerFormatter(new ContactFormatter())
  messageFormatterRegistry.registerFormatter(new LocationFormatter())
  messageFormatterRegistry.registerFormatter(new PollFormatter())
  messageFormatterRegistry.registerFormatter(new ReactionFormatter())

  // 1. Foundation services (no service dependencies)
  const contactService = new ContactService(prisma)
  const embeddingService = new EmbeddingService(prisma)
  const dataWipeService = new DataWipeService(prisma)
  const receiptService = new ReceiptService(prisma, contactService, getBus)
  const notificationService = new NotificationService(getMainWindow, messageFormatterRegistry)
  const secretMessageService = new SecretMessageService(prisma)
  secretMessageService.registerStrategy(new MessageReactionStrategy(getBus))
  const favoriteStickerService = new FavoriteStickerService(prisma)

  // 2. Services with service dependencies
  const chatService = new ChatService(prisma, contactService, messageFormatterRegistry)
  const groupHydrationService = new GroupHydrationService(prisma, contactService)
  const messageService = new MessageService(prisma, contactService, embeddingService, secretMessageService, getBus)
  const messageActionService = new MessageActionService(prisma, contactService, messageService, chatService, getBus)
  const mediaService = new MediaService(prisma, messageService, contactService, favoriteStickerService)
  const searchService = new SearchService(prisma, contactService, embeddingService)
  const identityReconciliationService = new IdentityReconciliationService(prisma)
  const profileSyncService = new ProfileSyncService(prisma, contactService)

  // 3. AI services (unchanged internally — just re-exported/wired)
  const aiService = new AIService()
  const aiChatSessionService = new AIChatSessionService(prisma)
  const aiChatExportService = new AIChatExportService()

  return {
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
    messageFormatterRegistry
  }
}

export type ServiceContainer = ReturnType<typeof createServices>


