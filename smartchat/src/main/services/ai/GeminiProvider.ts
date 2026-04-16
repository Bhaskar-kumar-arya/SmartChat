import { GoogleGenAI } from '@google/genai'
import { AIProvider, ModelInfo } from './Provider'
import { toolRegistry } from '../AIToolService'

export class GeminiProvider implements AIProvider {
  private ai: any;

  constructor() {
    // Hardcoded key as per original AIService.ts
    this.ai = new GoogleGenAI({ apiKey: 'AIzaSyDTfVHNlBOGLdgRSGISCPccYCq9-YLRGd0' });
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

  async generateResponse(prompt: string, history: any[], options: any): Promise<string> {
    const formattedHistory = this.formatHistory(history);
    const isPromptSystem = options?.isSystem === true;
    const finalPrompt = this.wrapWithRole(prompt, isPromptSystem, 'user');

    const useThinkMode = options?.useThinkMode !== false;
    const systemInstructions = this.getSystemPrompt(useThinkMode);
    const config = systemInstructions ? { systemInstruction: systemInstructions } : undefined;

    const chat = this.ai.chats.create({
      model: options?.model || "gemma-4-31b-it",
      config,
      history: formattedHistory
    });

    const response = await chat.sendMessage({ message: finalPrompt });
    return response.text || '';
  }

  async generateResponseStream(
    prompt: string,
    history: any[],
    options: any,
    onChunk: (chunk: string) => void
  ): Promise<void> {
    const formattedHistory = this.formatHistory(history);
    const isPromptSystem = options?.isSystem === true;
    const finalPrompt = this.wrapWithRole(prompt, isPromptSystem, 'user');

    const useThinkMode = options?.useThinkMode !== false;
    const systemInstructions = this.getSystemPrompt(useThinkMode);
    const config = systemInstructions ? { systemInstruction: systemInstructions } : undefined;

    const chat = this.ai.chats.create({
      model: options?.model || "gemma-4-31b-it",
      config,
      history: formattedHistory
    });

    const responseStream = await chat.sendMessageStream({ message: finalPrompt });
    for await (const chunk of responseStream) {
      if (chunk.text) {
        onChunk(chunk.text);
      }
    }
  }

  async getAvailableModels(): Promise<ModelInfo[]> {
    return [
      { id: 'gemma-4-31b-it', name: 'Gemma 4 31B IT', provider: 'gemini', isLocal: false },
      { id: 'gemini-3.1-flash-lite-preview', name: 'Gemini 3.1 Flash Lite', provider: 'gemini', isLocal: false },
      { id: 'gemma-3-27b-it', name: 'Gemma 3 27B IT', provider: 'gemini', isLocal: false },
      { id: 'gemini-3-flash-preview', name: 'Gemini 3 Flash Preview', provider: 'gemini', isLocal: false },
      { id: 'gemini-2.5-flash-lite', name: 'Gemini 2.5 Flash Lite', provider: 'gemini', isLocal: false },
    ];
  }
}
