import { Chat, LMStudioClient, rawFunctionTool } from '@lmstudio/sdk'
import { AIProvider, ModelInfo } from './Provider'
import { toolRegistry } from '../AIToolService'

export class LMStudioProvider implements AIProvider {
  private client: LMStudioClient;
  private loadedModels: Map<string, { model: any, contextLength: number }> = new Map();

  constructor() {
    this.client = new LMStudioClient();
  }

  private async getOrLoadModel(modelKey: string, contextLength?: number) {
    const requestedLength = contextLength || 1024 * 24;
    const existing = this.loadedModels.get(modelKey);

    if (existing) {
      if (existing.contextLength === requestedLength) {
        return existing.model;
      }
      
      // Context length mismatch - unload existing and reload
      console.log(`[LMStudioProvider] Context length mismatch for ${modelKey} (Existing: ${existing.contextLength}, Requested: ${requestedLength}). Reloading...`);
      try {
        await this.client.llm.unload(modelKey);
      } catch (e) {
        console.warn(`[LMStudioProvider] Failed to unload model during context switch:`, e);
      }
      this.loadedModels.delete(modelKey);
    }

    try {
      const model = await this.client.llm.load(modelKey, { 
        config: { contextLength: requestedLength, flashAttention : true }, 
        ttl: 600 // 10 mins TTL
      });
      this.loadedModels.set(modelKey, { model, contextLength: requestedLength });
      return model;
    } catch (error) {
      console.error(`[LMStudioProvider] Failed to load model ${modelKey}:`, error);
      throw error;
    }
  }

  getSystemPrompt(useThinkMode: boolean): string {
    const thinkProtocol = `
# RESPONSE PROTOCOL (CRITICAL — ALWAYS FOLLOW)
You MUST ALWAYS wrap your internal reasoning in a <think> block before every response (whether conversational or a tool).
Your output must always start with the think block. note : this block is your internal thought chain and will not be shown to the user.
The think block should be formatted as follows:

<think>
1. Your analysis of the conversation history.
2. Your analysis of the current message.
3. Your plan for next steps.
</think>

Your conversational response here.
`;

    const tools = toolRegistry.getAllTools().map(t => ({
      name: t.name,
      description: t.description,
      parameters: t.parametersSchema
    }));

    return `
You are an advanced, intelligent, and proactive AI assistant integrated directly into "smartChat", a modern WhatsApp-like messaging application.
The current system time is: ${new Date().toLocaleString()}.


# GENERAL DIRECTIVES & CONSTRAINTS
1. CONVERSATION: If the user's request is a conversational query and does NOT require tool execution, respond naturally in text.
2. NO HALLUCINATION: ONLY use the tools implicitly registered. Never assume capabilities you don't possess.
3. JID ACCURACY: Participant JIDs and their names/IDs are provided in the chat context. NEVER guess a JID.
4. CONCISE: Keep your conversational responses concise and helpful.
5. THINK BEFORE YOU RESPOND

${useThinkMode ? thinkProtocol : ''}
`;
  }

  async cleanup(): Promise<void> {
    console.log(`[LMStudioProvider] Cleaning up... Unloading ${this.loadedModels.size} models.`);
    for (const modelKey of this.loadedModels.keys()) {
      try {
        await this.client.llm.unload(modelKey);
      } catch (e) {
        console.warn(`[LMStudioProvider] Failed to unload ${modelKey} during cleanup:`, e);
      }
    }
    this.loadedModels.clear();
  }

  private getRawToolsInfo() {
    return {
      type: "toolArray",
      tools: toolRegistry.getAllTools().map(t => ({
        type: "function",
        function: {
          name: t.name,
          description: t.description,
          parameters: t.parametersSchema
        }
      }))
    };
  }

  async generateResponse(prompt: string, history: any[], options: any): Promise<string> {
    const modelKey = options?.model;
    if (!modelKey) throw new Error('No model specified for LM Studio');

    const model = await this.getOrLoadModel(modelKey, options?.contextLength);
    const chat = Chat.empty();
    
    const useThinkMode = options?.useThinkMode !== false;
    const systemInstructions = this.getSystemPrompt(useThinkMode);
    if (systemInstructions) {
      chat.append('system', systemInstructions);
    }

    for (const msg of history || []) {
       // LM Studio's chat.append requires strings or specific chat elements.
       chat.append(msg.role === 'user' ? 'user' : 'assistant', msg.content);
    }

    chat.append('user', prompt);

    let finalResponse = '';

    const prediction = model.respond(chat, {
      reasoning : {
        effort : 'high'
      },
      rawTools: this.getRawToolsInfo() as any,
      onPredictionFragment: (fragment) => {
         if (fragment.content) {
            finalResponse += fragment.content;
         }
      },
      onToolCallRequestEnd: (callId, info) => {
         const req = info.toolCallRequest as any;
         let argsObj = req.arguments || {};
         try {
             if (typeof argsObj === 'string') {
                 argsObj = JSON.parse(argsObj);
             }
         } catch (e) {}
         const xml = `\n<tool_call>\n{\n  "tool": "${req.name}",\n  "arguments": ${JSON.stringify(argsObj, null, 2)}\n}\n</tool_call>\n`;
         finalResponse += xml;
      },
    });

    await prediction;
    return finalResponse;
  }

  async generateResponseStream(
    prompt: string,
    history: any[],
    options: any,
    onChunk: (chunk: string) => void
  ): Promise<void> {
    const modelKey = options?.model;
    if (!modelKey) throw new Error('No model specified for LM Studio');

    const model = await this.getOrLoadModel(modelKey, options?.contextLength);
    const chat = Chat.empty();

    const useThinkMode = options?.useThinkMode !== false;
    const systemInstructions = this.getSystemPrompt(useThinkMode);
    if (systemInstructions) {
      chat.append('system', systemInstructions);
    }

    for (const msg of history || []) {
       chat.append(msg.role === 'user' ? 'user' : 'assistant', msg.content);
    }

    chat.append('user', prompt);

    const prediction = model.respond(chat, {
      reasoning : {
        effort : 'high'
      },
      rawTools: this.getRawToolsInfo() as any,
      onPredictionFragment: (fragment) => {
         if (fragment.content) {
            onChunk(fragment.content);
         }
      },
      onToolCallRequestEnd: (callId, info) => {
         const req = info.toolCallRequest as any;
         let argsObj = req.arguments || {};
         try {
             if (typeof argsObj === 'string') {
                 argsObj = JSON.parse(argsObj);
             }
         } catch (e) {}
         const xml = `\n<tool_call>\n{\n  "tool": "${req.name}",\n  "arguments": ${JSON.stringify(argsObj, null, 2)}\n}\n</tool_call>\n`;
         onChunk(xml);
      }
    });

    await prediction;
  }

  async getAvailableModels(): Promise<ModelInfo[]> {
    try {
      const models = await this.client.system.listDownloadedModels();
      return models
        .filter(m => m.type === 'llm')
        .map(m => ({
          id: m.modelKey,
          name: m.displayName || m.modelKey,
          provider: 'lmstudio' as const,
          description: `Architecture: ${m.architecture}, Params: ${m.paramsString}`,
          isLocal: true
        }));
    } catch (error) {
      console.warn('[LMStudioProvider] Could not fetch models from LM Studio:', error);
      return [];
    }
  }
}
