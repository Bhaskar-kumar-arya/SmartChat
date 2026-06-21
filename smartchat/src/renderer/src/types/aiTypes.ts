import { MessageItem, SelectedContext } from './chatTypes'

export interface ModelInfo {
  id: string
  name: string
  provider: 'gemini' | 'lmstudio' | 'groq' | 'mistral' | 'deepseek'
  description?: string
  isLocal: boolean
}

export interface AIChatOptions {
  useThinkMode: boolean
  model: string
  contextLength: number
  autoSaveChats: boolean
}

export interface AIChatSessionItem {
  id: string
  title: string
  createdAt: string
  updatedAt: string
  modelId?: string
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

export interface ToolDefinition {
  name: string
  description?: string
  argumentsSchema?: Record<string, any>
  requiresPermission?: boolean
}
