import { ISocketUserContext } from '../contacts/IContactService'

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

export interface SearchResults {
  chats: SearchResultItem[]
  messages: SearchResultItem[]
}

export interface SearchFilters {
  jids?: string[]
  fromDate?: Date
  toDate?: Date
}

export type SearchMode = 'normal' | 'deep'

export interface MentionResult {
  jid: string
  name: string
  pushName?: string | null
  verifiedName?: string | null
  phoneNumber?: string | null
  profilePictureUrl?: string | null
}

export interface ISearchService {
  searchAll(
    query: string,
    mode: SearchMode,
    sock: ISocketUserContext | null,
    filters?: SearchFilters
  ): Promise<SearchResults>
  
  searchMentionContacts(query: string): Promise<MentionResult[]>
  
  searchMentionChats(query: string): Promise<MentionResult[]>
}
