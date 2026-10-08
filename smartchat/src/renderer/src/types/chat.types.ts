import type { ChatItem } from '../../../shared/ipc/dto'

export type { ChatItem, SelectedContext } from '../../../shared/ipc/dto'

export interface ExtendedChatItem extends ChatItem {
  isChild?: boolean
  parentName?: string
  totalUnreadCount?: number
  children?: ChatItem[]
  // Extension-sourced synthetic chats
  source?: 'whatsapp' | 'extension'
  extensionId?: string
  extensionEmoji?: string
}
