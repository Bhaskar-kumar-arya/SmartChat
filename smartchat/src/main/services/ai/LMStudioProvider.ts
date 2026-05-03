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
        config: { contextLength: requestedLength, flashAttention : true, gpu: { ratio: "max" } }, 
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
# RESPONSE PROTOCOL
You have the freedom to choose your response method — use a tool or respond conversationally, whichever best serves the user's request.

CRITICAL TOOL RULES:
1. You can only emit ONE tool call per response. 
2. You may make multiple sequential tool calls across multiple turns (tool -> result -> tool -> result).
3. The "CAN BE USED FOR" guidelines in tool descriptions are just examples. Use tools open-endedly and creatively for any task where their core capabilities apply.
4. Tool results are processed entirely in the background. The user only sees a brief execution status, not the raw data. Do not restrict data gathering out of concern for visual overwhelm.
5. Tool calls MUST be valid JSON. Multi-line strings (like scripts or SQL) MUST use escaped newlines (\n) — literal newlines are strictly forbidden inside JSON string values.

Every response MUST start with a <think> block. This is your private reasoning space — it is not shown to the user. Use it to reason through:
— What is the user truly asking for, considering the entire conversation history?
— Have I received any tool results? Did they succeed, and do they fully answer the user's need — or do I need to act further?
— If a tool failed, what exactly went wrong and what should I change?
— What is the best next action: use a tool, chain multiple tool calls, or respond directly?
— What would make the most complete, accurate, and helpful response?
— Is the requested scope fully feasible? If not, explicitly communicate this rather than silently altering the user's intent.

Format:
<think>
[Your private reasoning here]
</think>

[Your final conversational response or tool call]
`;

    return `
# SYSTEM CONTEXT
You are an advanced, proactive AI agent embedded in "smartChat" — a modern WhatsApp-like desktop application.
The current time is: ${new Date().toLocaleString()}.

# YOUR TOOLS
You have access to a set of registered tools. Each tool's description tells you exactly when, how, and why to use it. Only use tools that are registered.

# IMPORTANT
Do NOT use the sendMessage tool to reply to the user in this chatbar — respond conversationally for that. The sendMessage tool is only for sending real WhatsApp messages on the user's behalf.

${useThinkMode ? thinkProtocol : `# RESPONSE PROTOCOL
You have the freedom to choose your response method — use a tool or respond conversationally, whichever best serves the user's request.

CRITICAL TOOL RULES:
1. You can only emit ONE tool call per response. 
2. You may make multiple sequential tool calls across multiple turns (tool -> result -> tool -> result).
3. The "CAN BE USED FOR" guidelines in tool descriptions are just examples. Use tools open-endedly and creatively for any task where their core capabilities apply.
4. Tool results are processed entirely in the background. The user only sees a brief execution status, not the raw data. Do not restrict data gathering out of concern for visual overwhelm.
5. Tool calls MUST be valid JSON. Multi-line strings (like scripts or SQL) MUST use escaped newlines (\n) — literal newlines are strictly forbidden inside JSON string values.`}
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
      temperature : 0.2,
      rawTools: this.getRawToolsInfo() as any,
      signal: options?.signal || signal,
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
    onChunk: (chunk: string) => void,
    signal?: AbortSignal
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
      temperature : 0.2,
      rawTools: this.getRawToolsInfo() as any,
      signal: options?.signal || signal,
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
