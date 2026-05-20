import { GoogleGenAI } from '@google/genai'
import { AIProvider, ModelInfo } from './Provider'
import { toolRegistry } from '../AIToolService'
import { aiKeyService } from '../AIKeyService'

export class GeminiProvider implements AIProvider {
  private ai: any;
  private fetchedModelIds = new Set<string>();
  private static readonly KNOWN_MODELS = new Set([
    'gemma-4-31b-it',
    'gemini-3.1-flash-lite-preview',
    'gemma-3-27b-it',
    'gemini-3-flash-preview',
    'gemini-2.5-flash-lite'
  ]);

  constructor() {
    const key = aiKeyService.getKey('gemini');
    this.ai = new GoogleGenAI({ apiKey: key }); 
  }

  updateApiKey(apiKey: string): void {
    this.ai = new GoogleGenAI({ apiKey });
  }

  canHandleModel(modelId: string): boolean {
    return this.fetchedModelIds.has(modelId) || 
           GeminiProvider.KNOWN_MODELS.has(modelId) ||
           modelId.startsWith('gemini-') ||
           modelId.startsWith('gemma-');
  }

  private wrapWithRole(content: string, isSystem: boolean, role: 'user' | 'model'): string {
    const label = role === 'model' ? 'AI' : (isSystem ? 'SYSTEM' : 'USER');
    return `[${label}]: ${content}`;
  }

  private formatHistory(history: any[]) {
    return (history || []).map(msg => {
      const isMsgSystem = (msg as any).isSystem === true;
      const role = (msg as any).role === 'user' ? 'user' : 'model';
      // Note: Full prompt building is still handled in AIService before calling provider
      return {
        role,
        parts: [{ text: this.wrapWithRole(msg.content, isMsgSystem, role as any) }]
      };
    });
  }

  getSystemPrompt(useThinkMode: boolean): string {
    return toolRegistry.getSystemInstructions(useThinkMode);
  }

  async cleanup(): Promise<void> {
    // Gemini handles cleanup on its end
  }

  async generateResponse(prompt: string, history: any[], options: any, signal?: AbortSignal): Promise<string> {
    const formattedHistory = this.formatHistory(history);
    const isPromptSystem = options?.isSystem === true;
    const finalPrompt = this.wrapWithRole(prompt, isPromptSystem, 'user');

    const useThinkMode = options?.useThinkMode !== false;
    const systemInstructions = this.getSystemPrompt(useThinkMode);
    
    // Prepare contents including history and current prompt
    const contents = [...formattedHistory, { role: 'user', parts: [{ text: finalPrompt }] }];
    
    const actualSignal = options?.signal || signal;
    const response = await this.ai.models.generateContent({
      model: options?.model || "gemma-4-31b-it",
      contents,
      config: systemInstructions ? { systemInstruction: systemInstructions } : undefined,
      signal: actualSignal
    });

    return response.text || '';
  }

  async generateResponseStream(
    prompt: string,
    history: any[],
    options: any,
    onChunk: (chunk: string) => void,
    signal?: AbortSignal
  ): Promise<void> {
    const formattedHistory = this.formatHistory(history);
    const isPromptSystem = options?.isSystem === true;
    const finalPrompt = this.wrapWithRole(prompt, isPromptSystem, 'user');

    const useThinkMode = options?.useThinkMode !== false;
    const systemInstructions = this.getSystemPrompt(useThinkMode);
    
    // Prepare contents including history and current prompt
    const contents = [...formattedHistory, { role: 'user', parts: [{ text: finalPrompt }] }];
    
    const actualSignal = options?.signal || signal;
    const responseStream = await this.ai.models.generateContentStream({
      model: options?.model || "gemma-4-31b-it",
      contents,
      config: systemInstructions ? { systemInstruction: systemInstructions } : undefined,
      signal: actualSignal
    });

    for await (const chunk of responseStream) {
      if (actualSignal?.aborted) break;
      if (chunk.text) {
        onChunk(chunk.text);
      }
    }
  }

  async getAvailableModels(): Promise<ModelInfo[]> {
    try {
      const list = await this.ai.models.list();
      const models: ModelInfo[] = [];
      for await (const m of list) {
        if (m.supportedActions && m.supportedActions.includes('generateContent')) {
          const strippedId = m.name.replace(/^models\//, '');
          this.fetchedModelIds.add(strippedId);
          models.push({
            id: strippedId,
            name: m.displayName || strippedId,
            provider: 'gemini' as const,
            description: m.description,
            isLocal: false
          });
        }
      }
      models.sort((a, b) => {
        if (a.id === 'gemma-4-31b-it') return -1;
        if (b.id === 'gemma-4-31b-it') return 1;
        return 0;
      });
      return models;
    } catch (error) {
      console.warn('[GeminiProvider] Could not fetch models from Gemini API, using fallbacks:', error);
      const fallbacks = [
        { id: 'gemma-4-31b-it', name: 'Gemma 4 31B IT', provider: 'gemini' as const, isLocal: false },
        { id: 'gemini-3.1-flash-lite-preview', name: 'Gemini 3.1 Flash Lite', provider: 'gemini' as const, isLocal: false },
        { id: 'gemma-3-27b-it', name: 'Gemma 3 27B IT', provider: 'gemini' as const, isLocal: false },
        { id: 'gemini-3-flash-preview', name: 'Gemini 3 Flash Preview', provider: 'gemini' as const, isLocal: false },
        { id: 'gemini-2.5-flash-lite', name: 'Gemini 2.5 Flash Lite', provider: 'gemini' as const, isLocal: false },
      ];
      for (const f of fallbacks) {
        this.fetchedModelIds.add(f.id);
      }
      return fallbacks;
    }
  }
}
