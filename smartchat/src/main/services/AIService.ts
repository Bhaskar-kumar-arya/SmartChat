import { GoogleGenAI } from '@google/genai'

export class AIService {
  private ai: any;

  constructor() {
    this.ai = new GoogleGenAI({ apiKey: 'AIzaSyB-pig4Fwo3LsdOmnwcqiv21p9otSDEaf8' });
  }

  private buildFullPrompt(prompt: string, contextFiles?: any[]): string {
    let fullPrompt = prompt;
    if (contextFiles && contextFiles.length > 0) {
      for (const chat of contextFiles) {
        let contextSection = `\n<chat_context metadata='{"name": "${chat.name}", "jid": "${chat.jid}"}'>\n`;
        chat.messages.forEach((msg: any) => {
           const sender = msg.fromMe ? 'Me' : (msg.participantName || msg.remoteJid);
           const content = msg.textContent || '[Non-text message]';
           contextSection += `[${new Date(Number(msg.timestamp) * 1000).toLocaleString()}] ${sender}: ${content}\n`;
        });
        contextSection += `</chat_context>\n`;

        const safeName = chat.name ? chat.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') : chat.jid;
        const mentionRegex = new RegExp(`@${safeName}`, 'g');
        if (mentionRegex.test(fullPrompt)) {
           fullPrompt = fullPrompt.replace(mentionRegex, `@${chat.name} ${contextSection}`);
        } else {
           fullPrompt += `\nContext for @${chat.name}:\n${contextSection}`;
        }
      }
    }
    return fullPrompt;
  }

  async generateResponse(
    prompt: string, 
    contextFiles?: any[],
    history?: any[]
  ): Promise<string> {
    try {
      const fullPrompt = this.buildFullPrompt(prompt, contextFiles);

      const formattedHistory = (history || []).map(msg => ({
        role: msg.role === 'user' ? 'user' : 'model',
        parts: [{ text: msg.role === 'user' ? this.buildFullPrompt(msg.content, msg.contexts) : msg.content }]
      }));

      const chat = this.ai.chats.create({
        model: "gemma-4-31b-it", // gemma-3-27b-it
        history: formattedHistory
      });

      const response = await chat.sendMessage({ message: fullPrompt });

      return response.text || '';
    } catch (error) {
      console.error('[AIService] Error generating response:', error);
      throw error;
    }
  }

  async generateResponseStream(
    prompt: string, 
    contextFiles?: any[],
    history?: any[],
    onChunk: (chunk: string) => void = () => {}
  ): Promise<void> {
    try {
      const fullPrompt = this.buildFullPrompt(prompt, contextFiles);

      const formattedHistory = (history || []).map(msg => ({
        role: msg.role === 'user' ? 'user' : 'model',
        parts: [{ text: msg.role === 'user' ? this.buildFullPrompt(msg.content, msg.contexts) : msg.content }]
      }));

      const chat = this.ai.chats.create({
        model: "gemma-4-31b-it", // gemma-3-27b-it
        history: formattedHistory
      });

      const responseStream = await chat.sendMessageStream({ message: fullPrompt });
      for await (const chunk of responseStream) {
        if (chunk.text) {
          onChunk(chunk.text);
        }
      }
    } catch (error) {
      console.error('[AIService] Error generating stream response:', error);
      throw error;
    }
  }
}

export const aiService = new AIService();
