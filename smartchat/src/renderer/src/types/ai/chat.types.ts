import { MessageItem } from '../message.types'
import { SelectedContext } from '../chat.types'

export interface AIChatOptions {
  useThinkMode: boolean
  model: string
  contextLength: number
  autoSaveChats: boolean
}

export interface AIContextItem {
  jid: string
  name: string
  messages: MessageItem[]
}

export interface AIChatMessage {
  id: string
  role: 'user' | 'ai'
  content: string
  contexts?: AIContextItem[]
  mentions?: SelectedContext[]
  isHidden?: boolean
  isSystem?: boolean
  toolResult?: string
  hasError?: boolean
}
