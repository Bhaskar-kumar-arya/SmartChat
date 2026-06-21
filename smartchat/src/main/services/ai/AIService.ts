import { GeminiProvider } from './providers/GeminiProvider'
import { LMStudioProvider } from './providers/LMStudioProvider'
import { GroqProvider } from './providers/GroqProvider'
import { MistralProvider } from './providers/MistralProvider'
import { DeepSeekProvider } from './providers/DeepSeekProvider'
import { IBaseAIProvider, ModelInfo } from './providers/Provider'
import { IStreamingProvider } from './providers/IStreamingProvider'
import { IFullResponseProvider } from './providers/IFullResponseProvider'
import { IAIKeyService } from './IAIKeyService'
import { IContactService } from '../contacts/IContactService'
import { IAIService, AIMention, AIChatContext, AIHistoryMessage } from './IAIService'
import { IToolRegistry } from './IToolRegistry'

export class AIService implements IAIService {
  private providers: Record<string, IBaseAIProvider> = {}
  private providerOrder: string[] = []
  private currentModelId: string = 'gemini:gemma-4-31b-it' // Default
  private activeRequests: Map<string, AbortController> = new Map()

  constructor(
    private readonly aiKeyService: IAIKeyService,
    private readonly contactService: IContactService,
    private readonly toolRegistry: IToolRegistry
  ) {
    this.registerProvider('gemini', new GeminiProvider(this.aiKeyService, this.toolRegistry));
    this.registerProvider('groq', new GroqProvider(this.aiKeyService, this.toolRegistry));
    this.registerProvider('mistral', new MistralProvider(this.aiKeyService, this.toolRegistry));
    this.registerProvider('deepseek', new DeepSeekProvider(this.aiKeyService, this.toolRegistry));
    this.registerProvider('lmstudio', new LMStudioProvider(this.toolRegistry)); // Fallback / local
  }

  registerProvider(key: string, provider: IBaseAIProvider): void {
    this.providers[key] = provider;
    this.providerOrder.push(key);
  }

  getProviderKeys(): Record<string, string> {
    return this.aiKeyService.getKeys() as unknown as Record<string, string>;
  }

  setProviderKey(provider: string, key: string): boolean {
    if (provider in this.providers) {
      this.aiKeyService.saveKey(provider, key);
      const updateMethod = this.providers[provider].updateApiKey;
      if (updateMethod) {
        updateMethod.call(this.providers[provider], key);
      }
      return true;
    }
    return false;
  }

  async cleanup(): Promise<void> {
    console.log('[AIService] Cleaning up providers...');
    for (const provider of Object.values(this.providers)) {
      await provider.cleanup().catch(e => console.error('[AIService] Provider cleanup failed:', e));
    }
  }

  private normalizeModelId(modelId: string): string {
    if (!modelId) return 'gemini:gemma-4-31b-it';
    if (modelId.includes(':')) {
      return modelId;
    }
    if (modelId.startsWith('gemini-') || modelId.startsWith('gemma-')) {
      return `gemini:${modelId}`;
    }
    if (modelId.startsWith('groq-') || modelId.startsWith('llama-') || modelId === 'openai/gpt-oss-120b') {
      return `groq:${modelId}`;
    }
    if (modelId.startsWith('mistral-') || modelId.startsWith('codestral-') || modelId.startsWith('pixtral-')) {
      return `mistral:${modelId}`;
    }
    if (modelId.startsWith('deepseek-')) {
      return `deepseek:${modelId}`;
    }
    return `lmstudio:${modelId}`;
  }

  private getProviderForModel(modelId: string): IBaseAIProvider {
    const normalized = this.normalizeModelId(modelId);
    for (const key of this.providerOrder) {
      if (this.providers[key].canHandleModel(normalized)) {
        return this.providers[key];
      }
    }
    // Default fallback to lmstudio if nothing matches
    return this.providers['lmstudio'];
  }

  private async getUserDetails(): Promise<{
    phoneNumber: string | null
    lid: string | null
    phoneJid: string | null
    linkedJid: string | null
  } | undefined> {
    try {
      const meJids = await this.contactService.getMeJids()
      const phoneJid = meJids.find(j => j.endsWith('@s.whatsapp.net')) || null
      const lidJid = meJids.find(j => j.endsWith('@lid')) || null
      const phoneNumber = phoneJid ? phoneJid.split('@')[0] : null
      const lid = lidJid ? lidJid.split('@')[0] : null
      return {
        phoneNumber,
        lid,
        phoneJid,
        linkedJid: lidJid
      }
    } catch (e) {
      console.warn('[AIService] Failed to resolve user details:', e)
      return undefined
    }
  }

  private formatMentions(prompt: string, mentions?: AIMention[]): string {
    let result = prompt
    if (mentions && mentions.length > 0) {
      for (const m of mentions) {
        const trimmedName = (m.name || '').trim()
        const safeName = trimmedName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
        const mentionRegex = new RegExp(`@${safeName}`, 'g')
        result = result.replace(mentionRegex, m.jid)
      }
    }
    return result
  }

  private formatChatHistory(chat: AIChatContext): string {
    let contextSection = `\n<chat_history id="${chat.jid}" name="${chat.name || 'Unknown'}">\n`
    const participantMap: Record<string, string> = {}
    chat.messages.forEach((msg) => {
       const senderId = msg.participant || (msg.fromMe ? 'me' : msg.chatJid)
       const senderName = msg.fromMe ? 'Me' : (msg.participantName || senderId.split('@')[0])
       if (senderId && !msg.fromMe && senderId !== 'me') {
         participantMap[senderId] = senderName
       }
    })

    if (Object.keys(participantMap).length > 0) {
      contextSection += `<participants>\n${JSON.stringify(participantMap, null, 2)}\n</participants>\n\n`
    }
    
    contextSection += `<messages>\n`
    chat.messages.forEach((msg) => {
       const senderId = msg.participant || (msg.fromMe ? 'me' : msg.chatJid)
       const senderName = msg.fromMe ? 'Me' : (msg.participantName || senderId.split('@')[0])
       const content = msg.textContent || '[Non-text message]'
       contextSection += `[${new Date(Number(msg.timestamp) * 1000).toLocaleString()}] ${senderName} (${senderId}): ${content}\n`
    })
    contextSection += `</messages>\n`

    contextSection += `</chat_history>\n`
    return contextSection
  }

  private buildFullPrompt(prompt: string, contextFiles?: AIChatContext[], mentions?: AIMention[]): string {
    let fullPrompt = this.formatMentions(prompt, mentions)

    if (contextFiles && contextFiles.length > 0) {
      for (const chat of contextFiles) {
        const contextSection = this.formatChatHistory(chat)
        const safeName = chat.name ? chat.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') : chat.jid
        const contextRegex = new RegExp(`/${safeName}`, 'g')
        if (contextRegex.test(fullPrompt)) {
           fullPrompt = fullPrompt.replace(contextRegex, `${chat.jid} \n${contextSection}`)
        } else {
           fullPrompt += `\n\n=== RELEVANT CHAT CONTEXT ===\n${contextSection}`
        }
      }
    }
    return fullPrompt
  }

  async getAvailableModels(): Promise<ModelInfo[]> {
    const allModelsLists = await Promise.all(
      this.providerOrder.map(async (key) => {
        try {
          return await this.providers[key].getAvailableModels();
        } catch (e) {
          console.error(`[AIService] Failed to get available models for ${key}:`, e);
          return [];
        }
      })
    );
    return allModelsLists.flat();
  }

  async generateResponse(
    prompt: string, 
    contextFiles?: AIChatContext[],
    history?: AIHistoryMessage[],
    mentions?: AIMention[],
    options?: { useThinkMode?: boolean, model?: string, isSystem?: boolean, requestId?: string }
  ): Promise<string> {
    try {
      const modelId = this.normalizeModelId(options?.model || this.currentModelId);
      const provider = this.getProviderForModel(modelId);
      
      const fullPrompt = this.buildFullPrompt(prompt, contextFiles, mentions);

      const processedHistory = (history || []).map(msg => {
        if (msg.role === 'user') {
          return { ...msg, content: this.buildFullPrompt(msg.content, msg.contexts, msg.mentions) };
        }
        return msg;
      });

      let signal: AbortSignal | undefined;
      if (options?.requestId) {
        const controller = new AbortController();
        this.activeRequests.set(options.requestId, controller);
        signal = controller.signal;
      }

      const userDetails = await this.getUserDetails()
      
      let result: string;
      if ('generateResponse' in provider && typeof provider.generateResponse === 'function') {
        result = await (provider as IFullResponseProvider).generateResponse(
          fullPrompt,
          processedHistory,
          { ...options, model: modelId, userDetails },
          signal
        );
      } else if ('generateResponseStream' in provider && typeof provider.generateResponseStream === 'function') {
        // Fallback: Buffer stream to full response
        let fullText = '';
        await (provider as IStreamingProvider).generateResponseStream(
          fullPrompt,
          processedHistory,
          { ...options, model: modelId, userDetails },
          (chunk) => { fullText += chunk; },
          signal
        );
        result = fullText;
      } else {
        throw new Error(`Provider for model ${modelId} does not support full response generation`);
      }
      
      if (options?.requestId) {
        this.activeRequests.delete(options.requestId);
      }
      
      return result;
    } catch (error) {
      if (options?.requestId) {
        this.activeRequests.delete(options.requestId);
      }
      console.error('[AIService] Error generating response:', error);
      throw error;
    }
  }

  async generateResponseStream(
    prompt: string, 
    contextFiles?: AIChatContext[],
    history?: AIHistoryMessage[],
    mentions?: AIMention[],
    options?: { useThinkMode?: boolean, model?: string, isSystem?: boolean, requestId?: string },
    onChunk: (chunk: string) => void = () => {}
  ): Promise<void> {
    try {
      const modelId = this.normalizeModelId(options?.model || this.currentModelId);
      const provider = this.getProviderForModel(modelId);

      const fullPrompt = this.buildFullPrompt(prompt, contextFiles, mentions);

      const processedHistory = (history || []).map(msg => {
        if (msg.role === 'user') {
          return { ...msg, content: this.buildFullPrompt(msg.content, msg.contexts, msg.mentions) };
        }
        return msg;
      });

      let signal: AbortSignal | undefined;
      if (options?.requestId) {
        const controller = new AbortController();
        this.activeRequests.set(options.requestId, controller);
        signal = controller.signal;
      }

      try {
        const userDetails = await this.getUserDetails()
        if ('generateResponseStream' in provider && typeof provider.generateResponseStream === 'function') {
          await (provider as IStreamingProvider).generateResponseStream(
            fullPrompt,
            processedHistory,
            { ...options, model: modelId, userDetails },
            onChunk,
            signal
          );
        } else if ('generateResponse' in provider && typeof provider.generateResponse === 'function') {
          // Fallback: full response as a single chunk
          const fullText = await (provider as IFullResponseProvider).generateResponse(
            fullPrompt,
            processedHistory,
            { ...options, model: modelId, userDetails },
            signal
          );
          onChunk(fullText);
        } else {
          throw new Error(`Provider for model ${modelId} does not support stream response generation`);
        }
      } finally {
        if (options?.requestId) {
          this.activeRequests.delete(options.requestId);
        }
      }
    } catch (error) {
      console.error('[AIService] Error generating stream response:', error);
      throw error;
    }
  }

  abortResponse(requestId: string): void {
    const controller = this.activeRequests.get(requestId);
    if (controller) {
      console.log(`[AIService] Aborting request: ${requestId}`);
      controller.abort();
      this.activeRequests.delete(requestId);
    }
  }
}
