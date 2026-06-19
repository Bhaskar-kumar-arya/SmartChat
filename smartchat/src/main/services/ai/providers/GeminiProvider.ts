import { GoogleGenAI } from '@google/genai'
import { AIProvider, ModelInfo } from './Provider'
import { toolRegistry } from '../AIToolService'
import { IAIKeyService } from '../IAIKeyService'

export class GeminiProvider implements AIProvider {
  private ai: GoogleGenAI;
  private fetchedModelIds = new Set<string>();
  constructor(private readonly aiKeyService: IAIKeyService) {
    const key = this.aiKeyService.getKey('gemini');
    this.ai = new GoogleGenAI({ apiKey: key }); 
  }

  updateApiKey(apiKey: string): void {
    this.ai = new GoogleGenAI({ apiKey });
  }

  canHandleModel(modelId: string): boolean {
    return modelId.startsWith('gemini:');
  }

  private wrapWithRole(content: string, isSystem: boolean, role: 'user' | 'model'): string {
    const label = role === 'model' ? 'AI' : (isSystem ? 'SYSTEM' : 'USER');
    return `[${label}]: ${content}`;
  }

  private formatHistory(history: Array<{ role: string; content: string; isSystem?: boolean }>) {
    return (history || []).map(msg => {
      const isMsgSystem = msg.isSystem === true;
      const role = msg.role === 'user' ? 'user' : 'model';
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

  async generateResponse(
    prompt: string,
    history: Array<{ role: string; content: string; isSystem?: boolean }>,
    options: { model?: string; useThinkMode?: boolean; isSystem?: boolean; signal?: AbortSignal },
    _signal?: AbortSignal
  ): Promise<string> {
    const formattedHistory = this.formatHistory(history);
    const isPromptSystem = options?.isSystem === true;
    const finalPrompt = this.wrapWithRole(prompt, isPromptSystem, 'user');

    const useThinkMode = options?.useThinkMode !== false;
    const systemInstructions = this.getSystemPrompt(useThinkMode);
    
    // Prepare contents including history and current prompt
    const contents = [...formattedHistory, { role: 'user', parts: [{ text: finalPrompt }] }];
    
    const rawModel = (options?.model || "gemini:gemma-4-31b-it").replace(/^gemini:/, '');
    const response = await this.ai.models.generateContent({
      model: rawModel,
      contents,
      config: systemInstructions ? { systemInstruction: systemInstructions } : undefined,
    });

    return response.text || '';
  }

  async generateResponseStream(
    prompt: string,
    history: Array<{ role: string; content: string; isSystem?: boolean }>,
    options: { model?: string; useThinkMode?: boolean; isSystem?: boolean; signal?: AbortSignal },
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
    const rawModel = (options?.model || "gemini:gemma-4-31b-it").replace(/^gemini:/, '');
    const responseStream = await this.ai.models.generateContentStream({
      model: rawModel,
      contents,
      config: systemInstructions ? { systemInstruction: systemInstructions } : undefined,
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
        if (m.name && m.supportedActions && m.supportedActions.includes('generateContent')) {
          const strippedId = m.name.replace(/^models\//, '');
          const prefixedId = `gemini:${strippedId}`;
          this.fetchedModelIds.add(prefixedId);
          models.push({
            id: prefixedId,
            name: m.displayName || strippedId,
            provider: 'gemini' as const,
            description: m.description,
            isLocal: false
          });
        }
      }
      models.sort((a, b) => {
        if (a.id === 'gemini:gemma-4-31b-it') return -1;
        if (b.id === 'gemini:gemma-4-31b-it') return 1;
        return 0;
      });
      return models;
    } catch (error) {
      console.warn('[GeminiProvider] Could not fetch models from Gemini API, using fallbacks:', error);
      const fallbacks = [
        { id: 'gemini:gemma-4-31b-it', name: 'Gemma 4 31B IT', provider: 'gemini' as const, isLocal: false },
        { id: 'gemini:gemini-3.1-flash-lite-preview', name: 'Gemini 3.1 Flash Lite', provider: 'gemini' as const, isLocal: false },
        { id: 'gemini:gemma-3-27b-it', name: 'Gemma 3 27B IT', provider: 'gemini' as const, isLocal: false },
        { id: 'gemini:gemini-3-flash-preview', name: 'Gemini 3 Flash Preview', provider: 'gemini' as const, isLocal: false },
        { id: 'gemini:gemini-2.5-flash-lite', name: 'Gemini 2.5 Flash Lite', provider: 'gemini' as const, isLocal: false },
      ];
      for (const f of fallbacks) {
        this.fetchedModelIds.add(f.id);
      }
      return fallbacks;
    }
  }
}
