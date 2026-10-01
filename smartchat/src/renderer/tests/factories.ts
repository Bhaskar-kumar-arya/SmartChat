import type { ChatItem, MessageItem } from '@renderer/types/chatTypes'

let seq = 0

/** Reset the id sequence; called from the global afterEach in setup.ts. */
export function resetFactories(): void {
  seq = 0
}

/** Build a MessageItem with unique id and sensible defaults; override anything. */
export function makeMessage(overrides: Partial<MessageItem> = {}): MessageItem {
  seq += 1
  return {
    id: `msg-${seq}`,
    chatJid: 'user1@s.whatsapp.net',
    fromMe: false,
    participant: null,
    timestamp: String(1600000000 + seq),
    status: 'READ',
    messageType: 'conversation',
    textContent: `Message ${seq}`,
    ...overrides,
  }
}

/** Build a ChatItem with unique jid and sensible defaults; override anything. */
export function makeChat(overrides: Partial<ChatItem> = {}): ChatItem {
  seq += 1
  return {
    jid: `chat-${seq}@s.whatsapp.net`,
    name: `Chat ${seq}`,
    unreadCount: 0,
    timestamp: String(1600000000 + seq),
    lastMessage: '',
    lastMessageTimestamp: String(1600000000 + seq),
    ...overrides,
  }
}
