import { GoogleGenAI } from '@google/genai'
import { toolRegistry } from './AIToolService'

export class AIService {
  private ai: any;

  constructor() {
    this.ai = new GoogleGenAI({ apiKey: 'AIzaSyB-pig4Fwo3LsdOmnwcqiv21p9otSDEaf8' });
  }

  private buildFullPrompt(prompt: string, contextFiles?: any[], mentions?: any[]): string {
    let fullPrompt = prompt;

    // 1. Handle Mentions (@JID injection)
    if (mentions && mentions.length > 0) {
      for (const m of mentions) {
        const safeName = m.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const mentionRegex = new RegExp(`@${safeName}`, 'g');
        fullPrompt = fullPrompt.replace(mentionRegex, `@${m.jid}`);
      }
    }

    // 2. Handle Contexts (Chat History)
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
        const contextRegex = new RegExp(`/${safeName}`, 'g');
        if (contextRegex.test(fullPrompt)) {
           fullPrompt = fullPrompt.replace(contextRegex, `/${chat.jid} ${contextSection}`);
        } else {
           fullPrompt += `\nContext for history reference /${chat.jid}:\n${contextSection}`;
        }
      }
    }
    return fullPrompt;
  }


  async generateResponse(
    prompt: string, 
    contextFiles?: any[],
    history?: any[],
    mentions?: any[]
  ): Promise<string> {
    try {
      const fullPrompt = this.buildFullPrompt(prompt, contextFiles, mentions);

      const formattedHistory = (history || []).map(msg => ({
        role: msg.role === 'user' ? 'user' : 'model',
        parts: [{ text: msg.role === 'user' ? this.buildFullPrompt(msg.content, msg.contexts, msg.mentions) : msg.content }]
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
    mentions?: any[],
    onChunk: (chunk: string) => void = () => {}
  ): Promise<void> {
    try {
      const fullPrompt = this.buildFullPrompt(prompt, contextFiles, mentions);

      const formattedHistory = (history || []).map(msg => ({
        role: msg.role === 'user' ? 'user' : 'model',
        parts: [{ text: msg.role === 'user' ? this.buildFullPrompt(msg.content, msg.contexts, msg.mentions) : msg.content }]
      }));


      const systemInstructions = toolRegistry.getSystemInstructions();
      const config = systemInstructions ? { systemInstruction: systemInstructions } : undefined;

      const chat = this.ai.chats.create({
        model: "gemma-4-31b-it", // gemma-3-27b-it // gemini-3.1-flash-lite-preview // gemma-4-31b-it
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
