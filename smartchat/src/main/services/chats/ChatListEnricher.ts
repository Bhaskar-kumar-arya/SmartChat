import { ChatListItem } from '../../types'
import { MessageFormatterRegistry } from '../messages/formatters/MessageFormatterRegistry'
import { ChatRepository } from './ChatRepository'
import { MessageRepository } from '../messages/MessageRepository'
import { ContactService } from '../contacts/ContactService'

export class ChatListEnricher {
  constructor(
    private readonly chatRepository: ChatRepository,
    private readonly messageRepository: MessageRepository,
    private readonly contactService: ContactService,
    private readonly formatterRegistry: MessageFormatterRegistry
  ) {}

  /**
   * Retrieves the chat list (paginated) and enriches it with the latest message/reaction.
   */
  async getChatList(page: number = 1, pageSize: number = 50): Promise<ChatListItem[]> {
    const skip = (page - 1) * pageSize
    const chats = await this.chatRepository.findChatsPaginated(skip, pageSize)
    
    // Auto-inject missing root communities so the frontend can properly nest subgroups
    const fetchedJids = new Set(chats.map(c => c.jid))
    const missingCommunityJids = new Set<string>()
    for (const chat of chats) {
      if ((chat.type === 'SUBGROUP' || chat.type === 'ANNOUNCE') && chat.community?.jid) {
        if (!fetchedJids.has(chat.community.jid)) {
          missingCommunityJids.add(chat.community.jid)
        }
      }
    }

    if (missingCommunityJids.size > 0) {
      const missingCommunities = await this.chatRepository.findChatsByJidsWithCommunity(Array.from(missingCommunityJids))
      chats.push(...missingCommunities)
    }

    // Fallback if chat.name is missing for a DM: resolve it dynamically
    const enriched = await Promise.all(
      chats.map(async (chat) => {
        let name = chat.name
        if (!name) {
          if (chat.type === 'DM') {
            const identId = await this.contactService.getIdentityIdByJid(chat.jid)
            if (identId) {
              const ident = await this.contactService.findIdentityById(identId)
              if (ident) {
                name = ident.displayName || ident.pushName || ident.verifiedName || ident.phoneNumber?.split('@')[0] || null
              }
            }
          }
          if (!name) {
            name = chat.jid.split('@')[0]
          }
        }

        // Fetch the most recent message for preview
        const lastMsg = await this.messageRepository.findLastMessage(chat.jid)

        // Fetch the most recent reaction for the chat
        const lastReaction = await this.messageRepository.findLastReaction(chat.jid)

        const reactionTs = lastReaction?.timestamp ?? 0n
        const msgTs = lastMsg?.timestamp ?? 0n
        const isReactionNewer = !!(lastReaction && (reactionTs > msgTs || lastMsg?.messageType === 'reactionMessage'))

        const effectiveTimestamp = isReactionNewer ? reactionTs : msgTs

        let lastMessageSender: string | null = null
        if (isReactionNewer && lastReaction) {
          if (lastReaction.sender.isMe) {
            lastMessageSender = 'You'
          } else {
            lastMessageSender = ContactService.getDisplayName(
              lastReaction.sender,
              lastReaction.sender.phoneNumber?.split('@')[0] || 'Someone'
            )
          }
        } else if (lastMsg) {
          if (lastMsg.fromMe) {
            lastMessageSender = 'You'
          } else {
            lastMessageSender = ContactService.getDisplayName(
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
          isCommunity: chat.type === 'COMMUNITY',
          isAnnounce: chat.type === 'ANNOUNCE',
          linkedParentJid: (chat.type === 'SUBGROUP' || chat.type === 'ANNOUNCE') ? (chat.community?.jid ?? null) : null,
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
      })
    )

    return enriched
  }
}
