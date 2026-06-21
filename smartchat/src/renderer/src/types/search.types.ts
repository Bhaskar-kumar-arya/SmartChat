export interface SearchResultItem {
  type: 'chat' | 'message'
  jid: string
  name: string
  lastMessage?: string
  messageId?: string
  snippet?: string
  timestamp?: string
  score?: number
}

export type SearchMode = 'normal' | 'deep'

export interface SearchFilters {
  jids?: string[]
  fromDate?: string // ISO string
  toDate?: string   // ISO string
}

export interface SearchResults {
  chats: SearchResultItem[]
  messages: SearchResultItem[]
}
