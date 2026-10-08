import { describe, it, expectTypeOf } from 'vitest'
import type {
  InvokeMap,
  SendMap,
  EventMap,
  InvokeArgs,
  InvokeResult,
  AiStreamEventMap
} from '../../../shared/ipc/contract'
import type { ChatListItem, EnrichedMessage, GroupParticipant, FavoriteStickerDto } from '../../../shared/ipc/dto'
import type { ChatListEntry } from '../../domain/chatList.types'
import type { IMessageActionService } from '../../services/messages/IMessageActionService'
import type { IMessageQueryService } from '../../services/messages/IMessageQueryService'
import type { IMediaService } from '../../services/messages/IMediaService'
import type { IFavoriteStickerService } from '../../services/messages/IFavoriteStickerService'
import type { IGroupParticipantResolver, IChatQueryService } from '../../services/chats/IChatService'
import type { ISearchService } from '../../services/search/ISearchService'
import type { IAIService } from '../../services/ai/IAIService'
import type { IAIChatSessionService } from '../../services/ai/IAIChatSessionService'
import type { INotificationService } from '../../services/notification/INotificationService'
import type { ICitationSessionManager } from '../../services/ai/citations/ICitationSessionManager'
import type { WhatsAppConnectionManager } from '../../services/whatsapp/WhatsAppConnectionManager'
import type { ToolResult } from '../../services/ai/IToolRegistry'
import type { EnrichedMessage as MainEnrichedMessage } from '../../ipc/message.types'

/**
 * Compile-time only (checked by `npm run typecheck:node`): the contract results
 * must equal what the main-side services actually return, and the contract
 * arguments must match the handlers' parameters. Runtime assertions are no-ops.
 */
describe('IPC contract types (C-01)', () => {
  it('old main/ipc DTO paths re-export the shared DTOs', () => {
    expectTypeOf<MainEnrichedMessage>().toEqualTypeOf<EnrichedMessage>()
  })

  it('chat results equal the chat service return type', () => {
    expectTypeOf<ChatListEntry>().toEqualTypeOf<ChatListItem>()
    type List = Awaited<ReturnType<IChatQueryService['getChatList']>>
    expectTypeOf<InvokeResult<'get-chats'>>().toEqualTypeOf<List>()
    expectTypeOf<InvokeResult<'get-chat'>>().toEqualTypeOf<ChatListItem | null>()
    type Parts = Awaited<ReturnType<IGroupParticipantResolver['getGroupParticipants']>>
    expectTypeOf<InvokeResult<'get-group-participants'>>().toEqualTypeOf<Parts>()
    expectTypeOf<Parts>().toEqualTypeOf<GroupParticipant[]>()
  })

  it('message results equal the message service return types', () => {
    type Page = Awaited<ReturnType<IMessageQueryService['getChatMessagesPage']>>
    expectTypeOf<InvokeResult<'get-messages'>>().toEqualTypeOf<Page>()
    expectTypeOf<InvokeArgs<'get-messages'>[1]>().toEqualTypeOf<Parameters<IMessageQueryService['getChatMessagesPage']>[1]>()
    expectTypeOf<InvokeResult<'get-messages-around'>>().toEqualTypeOf<Awaited<ReturnType<IMessageQueryService['getMessagesAroundId']>>>()
    expectTypeOf<InvokeResult<'send-message'>>().toEqualTypeOf<Awaited<ReturnType<IMessageActionService['sendMessageWorkflow']>>>()
    expectTypeOf<InvokeResult<'edit-message'>>().toEqualTypeOf<Awaited<ReturnType<IMessageActionService['editMessage']>>>()
    expectTypeOf<InvokeResult<'retry-message'>>().toEqualTypeOf<Awaited<ReturnType<IMessageActionService['retryFailedMessage']>>>()
    expectTypeOf<InvokeResult<'react-message'>>().toEqualTypeOf<Awaited<ReturnType<IMessageActionService['reactToMessage']>>>()
    expectTypeOf<InvokeResult<'send-media-message'>>().toEqualTypeOf<Awaited<ReturnType<IMessageActionService['sendMediaMessageWorkflow']>>>()
    expectTypeOf<InvokeResult<'download-media'>>().toEqualTypeOf<Awaited<ReturnType<IMediaService['downloadAndCacheMedia']>>>()
    expectTypeOf<InvokeResult<'get-favorite-stickers'>>().toEqualTypeOf<FavoriteStickerDto[]>()
    expectTypeOf<Awaited<ReturnType<IFavoriteStickerService['getFavoriteStickers']>>>().toEqualTypeOf<FavoriteStickerDto[]>()
  })

  it('search, AI, notification and sync results equal the service return types', () => {
    expectTypeOf<InvokeResult<'search-mention-contacts'>>().toEqualTypeOf<Awaited<ReturnType<ISearchService['searchMentionContacts']>>>()
    expectTypeOf<InvokeResult<'ai-chat'>>().toEqualTypeOf<Awaited<ReturnType<IAIService['generateResponse']>>>()
    expectTypeOf<InvokeResult<'get-ai-models'>>().toEqualTypeOf<Awaited<ReturnType<IAIService['getAvailableModels']>>>()
    expectTypeOf<InvokeResult<'get-ai-options'>>().toEqualTypeOf<Awaited<ReturnType<IAIChatSessionService['getAIOptions']>>>()
    expectTypeOf<InvokeResult<'execute-tool'>>().toEqualTypeOf<ToolResult>()
    expectTypeOf<InvokeResult<'citation:resolveAll'>>().toEqualTypeOf<Awaited<ReturnType<ICitationSessionManager['resolveAll']>>>()
    expectTypeOf<InvokeResult<'get-notification-preferences'>>().toEqualTypeOf<Awaited<ReturnType<INotificationService['getPreferences']>>>()
    expectTypeOf<InvokeArgs<'set-notification-preferences'>[0]>().toEqualTypeOf<Parameters<INotificationService['setPreferences']>[0]>()
    expectTypeOf<InvokeResult<'wa-skip-sync'>>().toEqualTypeOf<Awaited<ReturnType<WhatsAppConnectionManager['skipSync']>>>()
  })

  it('argument tuples keep optional and labelled positions', () => {
    expectTypeOf<InvokeArgs<'get-chats'>>().toEqualTypeOf<[page?: number, pageSize?: number]>()
    expectTypeOf<InvokeArgs<'wa-skip-sync'>>().toEqualTypeOf<[]>()
    expectTypeOf<InvokeArgs<'send-message'>>().toEqualTypeOf<[jid: string, text: string, quotedMsgId?: string, mentions?: string[]]>()
  })

  it('the three maps are disjoint channel namespaces and payloads are typed', () => {
    expectTypeOf<Extract<keyof InvokeMap, keyof SendMap>>().toEqualTypeOf<never>()
    expectTypeOf<Extract<keyof InvokeMap, keyof EventMap>>().toEqualTypeOf<never>()
    expectTypeOf<Extract<keyof SendMap, keyof EventMap>>().toEqualTypeOf<never>()
    expectTypeOf<EventMap['wa-sync-progress']>().toEqualTypeOf<[data: { progress: number; syncType: number; syncFullHistory: boolean }]>()
    expectTypeOf<AiStreamEventMap['error']>().toEqualTypeOf<[message: string]>()
  })
})
