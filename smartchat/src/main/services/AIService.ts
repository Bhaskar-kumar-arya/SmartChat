import { GoogleGenAI } from '@google/genai'
import { toolRegistry } from './AIToolService'

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
        contextSection += `Chat Name: ${chat.name}\nChat ID: ${chat.jid}\n\n`;
        const participantMap: Record<string, string> = {};

        chat.messages.forEach((msg: any) => {
           const senderId = msg.participant || (msg.fromMe ? 'me' : msg.remoteJid);
           const senderName = msg.fromMe ? 'Me' : (msg.participantName || senderId.split('@')[0]);
           const content = msg.textContent || '[Non-text message]';
           
           if (senderId && !msg.fromMe && senderId !== 'me') {
             participantMap[senderId] = senderName;
           }

           contextSection += `[${new Date(Number(msg.timestamp) * 1000).toLocaleString()}] ${senderName}: ${content}\n`;
        });

        if (Object.keys(participantMap).length > 0) {
          contextSection += `\nParticipant Identities (ID -> Name):\n${JSON.stringify(participantMap, null, 2)}\n`;
        }

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

      const systemInstructions = toolRegistry.getSystemInstructions();
      const config = systemInstructions ? { systemInstruction: systemInstructions } : undefined;

      const chat = this.ai.chats.create({
        model: "gemma-4-31b-it", // gemma-3-27b-it
        config,
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

      const systemInstructions = toolRegistry.getSystemInstructions();
      const config = systemInstructions ? { systemInstruction: systemInstructions } : undefined;

      const chat = this.ai.chats.create({
        model: "gemma-4-31b-it", // gemma-3-27b-it
        config,
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
