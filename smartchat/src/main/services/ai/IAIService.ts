import { AIProvider, ModelInfo } from './providers/Provider'

export interface AIMention {
  jid: string
  name?: string
}

export interface AIChatContext {
  jid: string
  name?: string | null
  messages: Array<{
    participant?: string | null
    fromMe?: boolean | null
    chatJid: string
    participantName?: string | null
    textContent?: string | null
    timestamp: bigint | number | string
  }>
}

export interface AIHistoryMessage {
  role: string
  content: string
  contexts?: AIChatContext[]
  mentions?: AIMention[]
  isSystem?: boolean
}

export interface IAIService {
  registerProvider(key: string, provider: AIProvider): void
  
  getProviderKeys(): Record<string, string>
  
  setProviderKey(provider: string, key: string): boolean
  
  cleanup(): Promise<void>
  
  getAvailableModels(): Promise<ModelInfo[]>
  
  generateResponse(
    prompt: string,
    contextFiles?: AIChatContext[],
    history?: AIHistoryMessage[],
    mentions?: AIMention[],
    options?: { useThinkMode?: boolean, model?: string, isSystem?: boolean, requestId?: string }
  ): Promise<string>
  
  generateResponseStream(
    prompt: string,
    contextFiles?: AIChatContext[],
    history?: AIHistoryMessage[],
    mentions?: AIMention[],
    options?: { useThinkMode?: boolean, model?: string, isSystem?: boolean, requestId?: string },
    onChunk?: (chunk: string) => void
  ): Promise<void>
  
  abortResponse(requestId: string): void
}
