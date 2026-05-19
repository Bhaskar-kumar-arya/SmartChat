import { GeminiProvider } from './ai/GeminiProvider'
import { LMStudioProvider } from './ai/LMStudioProvider'
import { GroqProvider } from './ai/GroqProvider'
import { MistralProvider } from './ai/MistralProvider'
import { AIProvider, ModelInfo } from './ai/Provider'

export class AIService {
  private providers: Record<string, AIProvider> = {}
  private providerOrder: string[] = []
  private currentModelId: string = 'gemma-4-31b-it' // Default
  private activeRequests: Map<string, AbortController> = new Map()

  constructor() {
    this.registerProvider('gemini', new GeminiProvider());
    this.registerProvider('groq', new GroqProvider());
    this.registerProvider('mistral', new MistralProvider());
    this.registerProvider('lmstudio', new LMStudioProvider()); // Fallback / local
  }

  registerProvider(key: string, provider: AIProvider): void {
    this.providers[key] = provider;
    this.providerOrder.push(key);
  }

  async cleanup(): Promise<void> {
    console.log('[AIService] Cleaning up providers...');
    for (const provider of Object.values(this.providers)) {
      await provider.cleanup().catch(e => console.error('[AIService] Provider cleanup failed:', e));
    }
  }

  private getProviderForModel(modelId: string): AIProvider {
    for (const key of this.providerOrder) {
      if (this.providers[key].canHandleModel(modelId)) {
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
           const senderId = msg.participant || (msg.fromMe ? 'me' : msg.remoteJid);
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
           const senderId = msg.participant || (msg.fromMe ? 'me' : msg.remoteJid);
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
      const modelId = options?.model || this.currentModelId;
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
      const modelId = options?.model || this.currentModelId;
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
