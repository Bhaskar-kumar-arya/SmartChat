import { Chat, LMStudioClient } from '@lmstudio/sdk'
import { ModelInfo } from './Provider'
import { IStreamingProvider } from './IStreamingProvider'
import { IFullResponseProvider } from './IFullResponseProvider'
import { IToolRegistry } from '../IToolRegistry'
import { UserDetails } from '../SystemPromptBuilder'

export class LMStudioProvider implements IStreamingProvider, IFullResponseProvider {
  private client: LMStudioClient;
  private loadedModels: Map<string, { model: Awaited<ReturnType<LMStudioClient['llm']['load']>>, contextLength: number }> = new Map();

  constructor(private readonly toolRegistry: IToolRegistry) {
    this.client = new LMStudioClient();
  }

  canHandleModel(modelId: string): boolean {
    return modelId.startsWith('lmstudio:');
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

  getSystemPrompt(useThinkMode: boolean, userDetails?: unknown): string {
    return this.toolRegistry.getSystemInstructions(useThinkMode, userDetails as UserDetails | undefined);
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
      tools: this.toolRegistry.getAllTools().map(t => ({
        type: "function",
        function: {
          name: t.name,
          description: t.description,
          parameters: t.parametersSchema
        }
      }))
    };
  }

  async generateResponse(
    prompt: string,
    history: Array<{ role: string; content: string }>,
    options: { model?: string; [key: string]: unknown },
    signal?: AbortSignal
  ): Promise<string> {
    const modelKey = typeof options?.model === 'string' ? options.model : undefined;
    if (!modelKey) throw new Error('No model specified for LM Studio');

    const cleanModelKey = modelKey.replace(/^lmstudio:/, '');
    const contextLength = typeof options?.contextLength === 'number' ? options.contextLength : undefined;
    const model = await this.getOrLoadModel(cleanModelKey, contextLength);
    const chat = Chat.empty();
    
    const useThinkMode = options?.useThinkMode !== false;
    const systemInstructions = this.getSystemPrompt(useThinkMode, options?.userDetails);
    if (systemInstructions) {
      chat.append('system', systemInstructions);
    }

    for (const msg of history || []) {
       // LM Studio's chat.append requires strings or specific chat elements.
       chat.append(msg.role === 'user' ? 'user' : 'assistant', msg.content);
    }

    chat.append('user', prompt);

    let finalResponse = '';
    const optionsSignal = options?.signal instanceof AbortSignal ? options.signal : undefined;

    
    const prediction = model.respond(chat, {
      reasoning : {
        effort : 'high'
      },
      temperature : 0.0,
      rawTools: this.getRawToolsInfo() as unknown as Exclude<Parameters<typeof model.respond>[1], undefined>['rawTools'],
      signal: optionsSignal || signal,
      onPredictionFragment: (fragment) => {
         if (fragment.content) {
            finalResponse += fragment.content;
         }
      },
      onToolCallRequestEnd: (_callId, info) => {
          finalResponse += this.formatToolCallXml(info as { toolCallRequest: { name: string; arguments?: string | Record<string, unknown> } }, 'generateResponse');
      },
    } as unknown as Parameters<typeof model.respond>[1]);

    await prediction;
    return finalResponse;
  }

  private formatToolCallXml(
    info: { toolCallRequest: { name: string; arguments?: string | Record<string, unknown> } },
    callerName: string
  ): string {
    const req = info.toolCallRequest;
    let argsObj = req.arguments || {};
    try {
      if (typeof argsObj === 'string') {
        argsObj = JSON.parse(argsObj) as Record<string, unknown>;
      }
    } catch (e: unknown) {
      console.warn(`[LMStudioProvider] Failed to parse tool arguments in ${callerName}:`, e);
    }
    return `\n<tool_call>\n{\n  "tool": "${req.name}",\n  "arguments": ${JSON.stringify(argsObj, null, 2)}\n}\n</tool_call>\n`;
  }

  async generateResponseStream(
    prompt: string,
    history: Array<{ role: string; content: string }>,
    options: { model?: string; [key: string]: unknown },
    onChunk: (chunk: string) => void,
    signal?: AbortSignal
  ): Promise<void> {
    const modelKey = typeof options?.model === 'string' ? options.model : undefined;
    if (!modelKey) throw new Error('No model specified for LM Studio');

    const cleanModelKey = modelKey.replace(/^lmstudio:/, '');
    const contextLength = typeof options?.contextLength === 'number' ? options.contextLength : undefined;
    const model = await this.getOrLoadModel(cleanModelKey, contextLength);
    const chat = Chat.empty();

    const useThinkMode = options?.useThinkMode !== false;
    const systemInstructions = this.getSystemPrompt(useThinkMode, options?.userDetails);
    if (systemInstructions) {
      chat.append('system', systemInstructions);
    }

    for (const msg of history || []) {
       chat.append(msg.role === 'user' ? 'user' : 'assistant', msg.content);
    }

    chat.append('user', prompt);
    const optionsSignal = options?.signal instanceof AbortSignal ? options.signal : undefined;

    const prediction = model.respond(chat, {
      reasoning : {
        effort : 'high'
      },
      temperature : 0.0,
      rawTools: this.getRawToolsInfo() as unknown as Exclude<Parameters<typeof model.respond>[1], undefined>['rawTools'],
      signal: optionsSignal || signal,
      onPredictionFragment: (fragment) => {
         if (fragment.content) {
            onChunk(fragment.content);
         }
      },
      onToolCallRequestEnd: (_callId, info) => {
          onChunk(this.formatToolCallXml(info as { toolCallRequest: { name: string; arguments?: string | Record<string, unknown> } }, 'generateResponseStream'));
      }
    } as unknown as Parameters<typeof model.respond>[1]);

    await prediction;
  }

  async getAvailableModels(): Promise<ModelInfo[]> {
    try {
      const models = await this.client.system.listDownloadedModels();
      return models
        .filter(m => m.type === 'llm')
        .map(m => ({
          id: `lmstudio:${m.modelKey}`,
          name: m.displayName || m.modelKey,
          provider: 'lmstudio' as const,
          description: `Architecture: ${m.architecture}, Params: ${m.paramsString}`,
          isLocal: true,
          quota: 'Infinite (Local Execution)'
        }));
    } catch (error) {
      console.warn('[LMStudioProvider] Could not fetch models from LM Studio:', error);
      return [];
    }
  }
}
