import { LMStudioClient } from '@lmstudio/sdk'
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

  private formatHistory(history: any[]) {
    return (history || []).map(msg => ({
      role: msg.role === 'user' ? 'user' : (msg.role === 'ai' || msg.role === 'model' ? 'assistant' : 'system'),
      content: msg.content
    }));
  }

  getSystemPrompt(useThinkMode: boolean): string {
    const tools = toolRegistry.getToolDefinitions();
    if (tools.length === 0) return '';

    const thinkProtocol = `
# RESPONSE PROTOCOL (CRITICAL — ALWAYS FOLLOW)
You MUST ALWAYS wrap your internal reasoning in a <think> block before every response (whether conversational or a tool).
Your output must always start with the think block. note : this block is your internal thought chain and will not be shown to the user.
The think block should be formatted as follows:

<think>
1. Your analysis of the conversation history.
2. Your analysis of the current message (tool result or User message).
3. Your plan for next steps.
</think>

**When calling a tool:**
<tool_call>
{
  "tool": "toolName",
  "arguments": {
    "argName": "value"
  }
}
</tool_call>

**When responding conversationally:**
Your response here.
`;

    const standardProtocol = `
# TOOL EXECUTION PROTOCOL (CRITICAL)
When you need to perform an action using a tool, you MUST use the following exact XML structure.
Do NOT reply with conversational text outside of these blocks when executing a tool. ONLY output the XML.
ensure to wrap in <tool_call>.....</tool_call>
<tool_call>
{
  "tool": "toolName",
  "arguments": {
    "argName": "value"
  }
}
</tool_call>
`;

    return `
You are an advanced, intelligent, and proactive AI assistant integrated directly into "smartChat", a modern WhatsApp-like messaging application.
The current system time is: ${new Date().toLocaleString()}.

# YOUR CAPABILITIES & TOOLS
You have access to the following strictly defined tools to interact with the application and fulfill user requests:
${JSON.stringify(tools, null, 2)}
NOTE : you dont have to unnecessarily use a tool in every message if not required, and if calling a tool , MAKE SURE you wrap it in <tool_call>...<.tool_call>

${useThinkMode ? thinkProtocol : standardProtocol}


# GENERAL DIRECTIVES & CONSTRAINTS
1. CONVERSATION: If the user's request is a conversational query and does NOT require tool execution, respond naturally in text.
2. NO HALLUCINATION: ONLY use the tools explicitly listed above. Never invent tool names or assume capabilities you don't possess.
3. JID ACCURACY: Participant JIDs and their names/IDs are provided in the chat context. NEVER guess a JID.
4. CONCISE: Keep your conversational responses concise and helpful.
5. YOU MUST STRICTLY FOLLOW THE RESPONSE FORMAT AT ANY COST AND MAKE NO MISTAKES IN THAT.
6. THINK BEFORE YOU RESPOND
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

  async generateResponse(prompt: string, history: any[], options: any): Promise<string> {
    const modelKey = options?.model;
    if (!modelKey) throw new Error('No model specified for LM Studio');

    const model = await this.getOrLoadModel(modelKey, options?.contextLength);
    const formattedHistory = this.formatHistory(history);
    
    const useThinkMode = options?.useThinkMode !== false;
    const systemInstructions = this.getSystemPrompt(useThinkMode);
    if (systemInstructions) {
      formattedHistory.unshift({ role: 'system', content: systemInstructions });
    }

    formattedHistory.push({ role: 'user', content: prompt });

    const result = await model.respond(formattedHistory);
    const finalResult = await result.result();
    return finalResult.content || '';
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
    const formattedHistory = this.formatHistory(history);

    const useThinkMode = options?.useThinkMode !== false;
    const systemInstructions = this.getSystemPrompt(useThinkMode);
    if (systemInstructions) {
      formattedHistory.unshift({ role: 'system', content: systemInstructions });
    }

    formattedHistory.push({ role: 'user', content: prompt });

    const stream = model.respond(formattedHistory);
    for await (const chunk of stream) {
      if (chunk.content) {
        onChunk(chunk.content);
      }
    }
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
