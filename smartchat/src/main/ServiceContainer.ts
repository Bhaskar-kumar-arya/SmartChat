import { PrismaClient } from '@prisma/client'
import { BrowserWindow } from 'electron'
import { ContactService } from './services/contacts/ContactService'
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

export function createServices(
  prisma: PrismaClient,
  getMainWindow: () => BrowserWindow | null,
  getBus: () => WAEventBus | null
) {
  // 1. Foundation services (no service dependencies)
  const contactService = new ContactService(prisma)
  const embeddingService = new EmbeddingService(prisma)
  const dataWipeService = new DataWipeService(prisma)
  const receiptService = new ReceiptService(prisma, contactService)
  const notificationService = new NotificationService(getMainWindow)
  const secretMessageService = new SecretMessageService(prisma)
  secretMessageService.registerStrategy(new MessageReactionStrategy(getBus))
  const favoriteStickerService = new FavoriteStickerService(prisma)

  // 2. Services with service dependencies
  const chatService = new ChatService(prisma, contactService)
  const groupHydrationService = new GroupHydrationService(prisma, contactService)
  const messageService = new MessageService(prisma, contactService, embeddingService, secretMessageService)
  const messageActionService = new MessageActionService(prisma, contactService, messageService, chatService, getBus)
  const mediaService = new MediaService(prisma, messageService, contactService, favoriteStickerService)
  const searchService = new SearchService(prisma, contactService, embeddingService)

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
    favoriteStickerService
  }
}

export type ServiceContainer = ReturnType<typeof createServices>


