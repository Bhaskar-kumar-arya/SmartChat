import { GoogleGenAI } from '@google/genai'

export class AIService {
  private ai: any;

  constructor() {
    this.ai = new GoogleGenAI({ apiKey: 'AIzaSyB-pig4Fwo3LsdOmnwcqiv21p9otSDEaf8' });
  }

  async generateResponse(
    prompt: string, 
    contextFiles?: { jid: string, name: string, messages: any[] }[],
    history?: { role: 'user' | 'ai', content: string }[]
  ): Promise<string> {
    try {
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

          const mentionRegex = new RegExp(`@${chat.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`, 'g');
          if (mentionRegex.test(fullPrompt)) {
             fullPrompt = fullPrompt.replace(mentionRegex, `@${chat.name} ${contextSection}`);
          } else {
             fullPrompt += `\nContext for @${chat.name}:\n${contextSection}`;
          }
        }
      }

      const formattedHistory = (history || []).map(msg => ({
        role: msg.role === 'user' ? 'user' : 'model',
        parts: [{ text: msg.content }]
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
}

export const aiService = new AIService();
