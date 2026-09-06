import { ChatListEntry } from '../../domain/chatList.types'
import { MessageFormatterRegistry } from '../messages/formatters/MessageFormatterRegistry'
import { IChatRepository, ChatWithCommunity } from './IChatRepository'
import { IReactionRepository } from '../messages/IReactionRepository'
import { IMessageSearchRepository } from '../messages/IMessageSearchRepository'
import { IContactQueryService } from '../contacts/IContactService'
import { ContactNameResolver } from '../contacts/ContactNameResolver'
import { IChatListEnricher } from './IChatListEnricher'

export class ChatListEnricher implements IChatListEnricher {
  constructor(
    private readonly chatRepository: IChatRepository,
    private readonly messageQueryRepository: IMessageSearchRepository,
    private readonly reactionRepository: IReactionRepository,
    private readonly contactService: IContactQueryService,
    private readonly formatterRegistry: MessageFormatterRegistry
  ) {}

  /**
   * Retrieves the chat list (paginated) and enriches it with the latest message/reaction.
   */
  async getChatList(page: number = 1, pageSize: number = 50): Promise<ChatListEntry[]> {
    const skip = (page - 1) * pageSize
    const windowChats = await this.chatRepository.findChatsPaginated(skip, pageSize)

    const fetchedJids = new Set(windowChats.map(c => c.jid))
    const communityJids = new Set<string>()

    for (const chat of windowChats) {
      if (chat.type === 'COMMUNITY') {
        communityJids.add(chat.jid)
      } else if (chat.type !== 'COMMUNITY' && chat.community?.jid) {
        communityJids.add(chat.community.jid)
      }
    }

    // Community roots/siblings pulled in so the renderer can build the hierarchy
    // even when only one member chat landed on this page. These are NOT part of
    // the requested pagination window — they are flagged `outOfWindow` so the
    // caller doesn't count them toward "was this a full page?" (which previously
    // corrupted the has-more signal and made pages overlap unpredictably).
    const siblingChats: typeof windowChats = []
    if (communityJids.size > 0) {
      const communityChats = await this.chatRepository.findChatsByCommunityJids(Array.from(communityJids))
      for (const cc of communityChats) {
        if (!fetchedJids.has(cc.jid)) {
          siblingChats.push(cc)
          fetchedJids.add(cc.jid)
        }
      }
    }

    const enriched = await Promise.all([
      ...windowChats.map(chat => this.enrichSingleChat(chat)),
      ...siblingChats.map(chat =>
        this.enrichSingleChat(chat).then(e => ({ ...e, outOfWindow: true }))
      )
    ])

    return enriched as ChatListEntry[]
  }

  /**
   * Retrieves a single enriched chat by its JID.
   */
  async getChatByJid(jid: string): Promise<ChatListEntry | null> {
    const chats = await this.chatRepository.findChatsByJidsWithCommunity([jid])
    if (chats.length === 0) return null
    return this.enrichSingleChat(chats[0])
  }

  private async resolveChatName(chat: ChatWithCommunity): Promise<string> {
    let name = chat.name
    if (name) return name

    if (chat.type === 'COMMUNITY' && chat.community?.name) {
      return chat.community.name
    }

    if (chat.type === 'DM') {
      const identId = await this.contactService.getIdentityIdByJid(chat.jid)
      if (identId) {
        const ident = await this.contactService.findIdentityById(identId)
        if (ident) {
          const resolvedName = ident.displayName || ident.pushName || ident.verifiedName || ident.phoneNumber?.split('@')[0] || null
          if (resolvedName) return resolvedName
        }
      }
    }

    return chat.jid.split('@')[0]
  }

  private async enrichSingleChat(chat: ChatWithCommunity): Promise<ChatListEntry> {
    const name = await this.resolveChatName(chat)

    // Fetch the most recent message for preview
    const lastMsg = await this.messageQueryRepository.findLastMessage(chat.jid)

    // Fetch the most recent reaction for the chat
    const lastReaction = await this.reactionRepository.findLastReaction(chat.jid)

    const reactionTs = lastReaction?.timestamp ?? 0n
    const msgTs = lastMsg?.timestamp ?? 0n
    const isReactionNewer = !!(lastReaction && (reactionTs > msgTs || lastMsg?.messageType === 'reactionMessage'))

    const effectiveTimestamp = isReactionNewer ? reactionTs : msgTs

    let lastMessageSender: string | null = null
    if (isReactionNewer && lastReaction) {
      if (lastReaction.sender.isMe) {
        lastMessageSender = 'You'
      } else {
        lastMessageSender = ContactNameResolver.getDisplayName(
          lastReaction.sender,
          lastReaction.sender.phoneNumber?.split('@')[0] || 'Someone'
        )
      }
    } else if (lastMsg) {
      if (lastMsg.fromMe) {
        lastMessageSender = 'You'
      } else {
        lastMessageSender = ContactNameResolver.getDisplayName(
          lastMsg.sender,
          lastMsg.participant?.split('@')[0] || 'Someone'
        )
      }
    }

    let lastMessageText = ''
    if (isReactionNewer && lastReaction) {
      const targetPreview = this.formatterRegistry.format(
        null,
        {
          textContent: lastReaction.message.textContent,
          messageType: lastReaction.message.messageType
        },
        'chatListReaction'
      )
      lastMessageText = `Reacted ${lastReaction.text} to ${targetPreview || 'message'}`
    } else if (lastMsg) {
      lastMessageText = this.formatterRegistry.format(
        null,
        {
          textContent: lastMsg.textContent,
          messageType: lastMsg.messageType
        },
        'chatList'
      )
    }

    return {
      jid: chat.jid,
      name,
      unreadCount: chat.unreadCount,
      timestamp: effectiveTimestamp.toString(),
      lastMessage: lastMessageText,
      lastMessageType: isReactionNewer ? 'reactionMessage' : (lastMsg?.messageType || null),
      lastMessageTimestamp: effectiveTimestamp.toString(),
      pinned: chat.pinned,
      muteExpiration: chat.muteExpiration.toString(),
      profilePictureUrl: chat.profilePictureUrl,
      isCommunity: chat.type === 'COMMUNITY' || (!!chat.community && chat.jid === chat.community.jid),
      isAnnounce: chat.type === 'ANNOUNCE',
      linkedParentJid: (chat.jid !== chat.community?.jid) ? (chat.community?.jid ?? null) : null,
      lastMessageSender,
      lastMessageStatus: isReactionNewer ? null : (lastMsg?.status || null),
      lastMessageFromMe: isReactionNewer ? (lastReaction?.sender.isMe ?? false) : (lastMsg?.fromMe || false),
      lastMessageId: isReactionNewer ? (lastReaction?.message.id ?? null) : (lastMsg?.id || null),
      lastMessageTargetType: isReactionNewer ? (lastReaction?.message.messageType || null) : null,
      lastMessageTargetText: isReactionNewer ? (this.formatterRegistry.format(
        null,
        {
          messageType: lastReaction?.message.messageType || 'unknown',
          textContent: lastReaction?.message.textContent || null
        },
        'chatListReaction'
      ) || 'message') : null,
      lastMessageReactionText: isReactionNewer ? (lastReaction?.text || null) : null
    }
  }
}
