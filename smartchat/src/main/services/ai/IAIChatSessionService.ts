import { AIChatContext, AIMention } from './IAIService'

export interface AIChatMessageInput {
  role: 'user' | 'ai'
  content: string
  contexts?: AIChatContext[]
  mentions?: AIMention[]
  isHidden?: boolean
  isSystem?: boolean
  toolResult?: string
  hasError?: boolean
}

export interface IAIChatSessionService {
  createSession(title: string, modelId?: string | null): Promise<any>
  
  listSessions(page?: number, pageSize?: number): Promise<any[]>
  
  getSession(id: string): Promise<any | null>
  
  renameSession(id: string, title: string): Promise<any>
  
  deleteSession(id: string): Promise<void>
  
  cloneSession(id: string): Promise<any>
  
  saveMessages(sessionId: string, messages: AIChatMessageInput[]): Promise<void>
  
  getAIOptions(): Promise<{ useThinkMode: boolean; model: string; contextLength: number; autoSaveChats: boolean }>
  
  setAIOptions(options: Record<string, unknown>): Promise<void>
  
  getAutoSavePreference(): Promise<boolean>
  
  setAutoSavePreference(enabled: boolean): Promise<void>
}
