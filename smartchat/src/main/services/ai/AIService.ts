import { GeminiProvider } from './providers/GeminiProvider'
import { LMStudioProvider } from './providers/LMStudioProvider'
import { GroqProvider } from './providers/GroqProvider'
import { MistralProvider } from './providers/MistralProvider'
import { DeepSeekProvider } from './providers/DeepSeekProvider'
import { AIProvider, ModelInfo } from './providers/Provider'
import { aiKeyService } from './AIKeyService'

export class AIService {
  private providers: Record<string, AIProvider> = {}
  private providerOrder: string[] = []
  private currentModelId: string = 'gemini:gemma-4-31b-it' // Default
  private activeRequests: Map<string, AbortController> = new Map()

  constructor() {
    this.registerProvider('gemini', new GeminiProvider());
    this.registerProvider('groq', new GroqProvider());
    this.registerProvider('mistral', new MistralProvider());
    this.registerProvider('deepseek', new DeepSeekProvider());
    this.registerProvider('lmstudio', new LMStudioProvider()); // Fallback / local
  }

  registerProvider(key: string, provider: AIProvider): void {
    this.providers[key] = provider;
    this.providerOrder.push(key);
  }

  getProviderKeys(): Record<string, string> {
    return aiKeyService.getKeys() as any;
  }

  setProviderKey(provider: string, key: string): boolean {
    if (provider in this.providers) {
      aiKeyService.saveKey(provider as any, key);
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

  private getProviderForModel(modelId: string): AIProvider {
    const normalized = this.normalizeModelId(modelId);
    for (const key of this.providerOrder) {
      if (this.providers[key].canHandleModel(normalized)) {
        return this.providers[key];
      }
    }
    // Default fallback to lmstudio if nothing matches
    return this.providers['lmstudio'];
  }

  private buildFullPrompt(prompt: string, contextFiles?: any[], mentions?: any[]): string {
    let fullPrompt = prompt;

    // 1. Handle Mentions (@JID injection)
    if (mentions && mentions.length > 0) {
      for (const m of mentions) {
        const trimmedName = (m.name || '').trim();
        const safeName = trimmedName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const mentionRegex = new RegExp(`@${safeName}`, 'g');
        fullPrompt = fullPrompt.replace(mentionRegex, m.jid);
      }
    }

    // 2. Handle Contexts (Chat History)
    if (contextFiles && contextFiles.length > 0) {
      for (const chat of contextFiles) {
        let contextSection = `\n<chat_history id="${chat.jid}" name="${chat.name || 'Unknown'}">\n`;
        const participantMap: Record<string, string> = {};
        chat.messages.forEach((msg: any) => {
           const senderId = msg.participant || (msg.fromMe ? 'me' : msg.chatJid);
           const senderName = msg.fromMe ? 'Me' : (msg.participantName || senderId.split('@')[0]);
           if (senderId && !msg.fromMe && senderId !== 'me') {
             participantMap[senderId] = senderName;
           }
        });

        if (Object.keys(participantMap).length > 0) {
          contextSection += `<participants>\n${JSON.stringify(participantMap, null, 2)}\n</participants>\n\n`;
        }
        
        contextSection += `<messages>\n`;
        chat.messages.forEach((msg: any) => {
           const senderId = msg.participant || (msg.fromMe ? 'me' : msg.chatJid);
           const senderName = msg.fromMe ? 'Me' : (msg.participantName || senderId.split('@')[0]);
           const content = msg.textContent || '[Non-text message]';
           contextSection += `[${new Date(Number(msg.timestamp) * 1000).toLocaleString()}] ${senderName} (${senderId}): ${content}\n`;
        });
        contextSection += `</messages>\n`;

        contextSection += `</chat_history>\n`;
        const safeName = chat.name ? chat.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') : chat.jid;
        const contextRegex = new RegExp(`/${safeName}`, 'g');
        if (contextRegex.test(fullPrompt)) {
           fullPrompt = fullPrompt.replace(contextRegex, `${chat.jid} \n${contextSection}`);
        } else {
           fullPrompt += `\n\n=== RELEVANT CHAT CONTEXT ===\n${contextSection}`;
        }
      }
    }
    return fullPrompt;
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
    contextFiles?: any[],
    history?: any[],
    mentions?: any[],
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

      const result = await provider.generateResponse(fullPrompt, processedHistory, { ...options, model: modelId }, signal);
      
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
    contextFiles?: any[],
    history?: any[],
    mentions?: any[],
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
        await provider.generateResponseStream(fullPrompt, processedHistory, { ...options, model: modelId }, onChunk, signal);
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

export const aiService = new AIService();
