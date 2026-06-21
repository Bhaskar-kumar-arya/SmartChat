import OpenAI from 'openai';
import { ModelInfo } from './Provider';
import { IStreamingProvider } from './IStreamingProvider';
import { IFullResponseProvider } from './IFullResponseProvider';
import { IToolRegistry } from '../IToolRegistry';
import { IAIKeyService } from '../IAIKeyService';
import { UserDetails } from '../SystemPromptBuilder';

export class DeepSeekProvider implements IStreamingProvider, IFullResponseProvider {
  private client: OpenAI;

  constructor(
    private readonly aiKeyService: IAIKeyService,
    private readonly toolRegistry: IToolRegistry
  ) {
    const apiKey = this.aiKeyService.getKey('deepseek');
    const baseURL = process.env.DEEPSEEK_BASE_URL || 'https://api.deepseek.com';
    this.client = new OpenAI({ apiKey, baseURL });
  }

  updateApiKey(apiKey: string): void {
    const baseURL = process.env.DEEPSEEK_BASE_URL || 'https://api.deepseek.com';
    this.client = new OpenAI({ apiKey, baseURL });
  }

  canHandleModel(modelId: string): boolean {
    return modelId.startsWith('deepseek:');
  }

  getSystemPrompt(useThinkMode: boolean, userDetails?: unknown): string {
    return this.toolRegistry.getSystemInstructions(useThinkMode, userDetails as UserDetails | undefined);
  }

  async cleanup(): Promise<void> {
    // No local resources to unload
  }

  private formatMessages(
    prompt: string,
    history: Array<{ role: string; content: string }>,
    systemPrompt: string
  ): OpenAI.Chat.ChatCompletionMessageParam[] {
    const messages: OpenAI.Chat.ChatCompletionMessageParam[] = [];
    if (systemPrompt) {
      messages.push({ role: 'system', content: systemPrompt });
    }

    for (const msg of history || []) {
      const role = msg.role === 'model' || msg.role === 'assistant' ? 'assistant' : 'user';
      messages.push({ role, content: msg.content });
    }

    messages.push({ role: 'user', content: prompt });
    return messages;
  }

  private getToolsForDeepSeek(): Array<{ type: 'function'; function: { name: string; description: string; parameters: Record<string, unknown> } }> {
    return this.toolRegistry.getAllTools().map(t => ({
      type: 'function' as const,
      function: {
        name: t.name,
        description: t.description,
        parameters: t.parametersSchema as Record<string, unknown>
      }
    }));
  }

  private stripPrefix(modelId: string): string {
    return modelId.replace(/^deepseek:/, '');
  }

  async generateResponse(
    prompt: string,
    history: Array<{ role: string; content: string }>,
    options: { model?: string; [key: string]: unknown },
    signal?: AbortSignal
  ): Promise<string> {
    const modelOption = typeof options?.model === 'string' ? options.model : 'deepseek-v4-pro';
    const rawModel = this.stripPrefix(modelOption);
    const useThinkMode = options?.useThinkMode !== false;
    const systemPrompt = this.getSystemPrompt(useThinkMode, options?.userDetails);
    const messages = this.formatMessages(prompt, history, systemPrompt);
    
    // Tools are supported for deepseek-v4-pro/deepseek-chat
    const isReasoner = rawModel.includes('reasoner');
    const tools = isReasoner ? [] : this.getToolsForDeepSeek();

    const optionsSignal = options?.signal instanceof AbortSignal ? options.signal : undefined;
    const actualSignal = optionsSignal || signal;

    const response = await this.client.chat.completions.create({
      model: rawModel,
      messages,
      tools: tools.length > 0 ? tools : undefined,
      temperature: isReasoner ? undefined : 0.0, // deepseek recommends leaving temp out for reasoner
    }, { signal: actualSignal });

    const message = response.choices[0]?.message;
    let finalResponse = message?.content || '';

    // If there is reasoning content returned natively, we can prepend it
    const msgWithReasoning = message as OpenAI.Chat.Completions.ChatCompletionMessage & { reasoning_content?: string };
    const reasoningContent = msgWithReasoning?.reasoning_content;
    if (reasoningContent) {
      finalResponse = `<think>\n${reasoningContent}\n</think>\n\n` + finalResponse;
    }

    // Convert native tool calls to XML format if present
    if (message?.tool_calls && message.tool_calls.length > 0) {
      for (const tc of message.tool_calls) {
        if (tc.type === 'function' && tc.function.name) {
          let argsObj = {};
          try {
            argsObj = JSON.parse(tc.function.arguments);
          } catch (e: unknown) {
            console.warn('Failed to parse DeepSeek tool call arguments:', tc.function.arguments);
          }
          const xml = `\n<tool_call>\n{\n  "tool": "${tc.function.name}",\n  "arguments": ${JSON.stringify(argsObj, null, 2)}\n}\n</tool_call>\n`;
          finalResponse += xml;
        }
      }
    }

    return finalResponse;
  }

  async generateResponseStream(
    prompt: string,
    history: Array<{ role: string; content: string }>,
    options: { model?: string; [key: string]: unknown },
    onChunk: (chunk: string) => void,
    signal?: AbortSignal
  ): Promise<void> {
    const modelOption = typeof options?.model === 'string' ? options.model : 'deepseek-v4-pro';
    const rawModel = this.stripPrefix(modelOption);
    const useThinkMode = options?.useThinkMode !== false;
    const systemPrompt = this.getSystemPrompt(useThinkMode, options?.userDetails);
    const messages = this.formatMessages(prompt, history, systemPrompt);
    
    const isReasoner = rawModel.includes('reasoner');
    const tools = isReasoner ? [] : this.getToolsForDeepSeek();

    const optionsSignal = options?.signal instanceof AbortSignal ? options.signal : undefined;
    const actualSignal = optionsSignal || signal;

    const stream = await this.client.chat.completions.create({
      model: rawModel,
      messages,
      tools: tools.length > 0 ? tools : undefined,
      temperature: isReasoner ? undefined : 0.0,
      stream: true
    }, { signal: actualSignal });

    const toolCalls: Array<{
      id: string
      type: 'function'
      function: { name: string; arguments: string }
    }> = [];
    let hasEmittedReasoningStart = false;
    let hasEmittedReasoningEnd = false;

    for await (const chunk of stream) {
      if (actualSignal?.aborted) break;

      const delta = chunk.choices[0]?.delta as OpenAI.Chat.Completions.ChatCompletionChunk.Choice.Delta & { reasoning_content?: string };
      if (!delta) continue;

      // Handle DeepSeek reasoning_content streaming natively
      if (delta.reasoning_content) {
        if (!hasEmittedReasoningStart) {
          onChunk('<think>\n');
          hasEmittedReasoningStart = true;
        }
        onChunk(delta.reasoning_content);
      } else if (hasEmittedReasoningStart && !hasEmittedReasoningEnd) {
        onChunk('\n</think>\n\n');
        hasEmittedReasoningEnd = true;
      }

      if (delta.content) {
        onChunk(delta.content);
      }

      if (delta.tool_calls) {
        for (const toolCallDelta of delta.tool_calls) {
          const idx = toolCallDelta.index;
          if (!toolCalls[idx]) {
            toolCalls[idx] = {
              id: toolCallDelta.id || '',
              type: 'function',
              function: { name: '', arguments: '' }
            };
          }
          if (toolCallDelta.id) {
            toolCalls[idx].id = toolCallDelta.id;
          }
          if (toolCallDelta.function?.name) {
            toolCalls[idx].function.name += toolCallDelta.function.name;
          }
          if (toolCallDelta.function?.arguments) {
            toolCalls[idx].function.arguments += toolCallDelta.function.arguments;
          }
        }
      }
    }

    // In case thinking ended right when stream finished
    if (hasEmittedReasoningStart && !hasEmittedReasoningEnd) {
      onChunk('\n</think>\n\n');
    }

    // After stream completes, emit accumulated tool calls as XML chunks
    for (const tc of toolCalls) {
      if (tc && tc.function.name) {
        let argsObj = {};
        try {
          argsObj = JSON.parse(tc.function.arguments);
        } catch (e: unknown) {
          console.warn('Failed to parse DeepSeek streamed tool call arguments:', tc.function.arguments);
        }
        const xml = `\n<tool_call>\n{\n  "tool": "${tc.function.name}",\n  "arguments": ${JSON.stringify(argsObj, null, 2)}\n}\n</tool_call>\n`;
        onChunk(xml);
      }
    }
  }

  async getAvailableModels(): Promise<ModelInfo[]> {
    try {
      const list = await this.client.models.list();
      const models = list.data
        .filter(m => {
          const id = m.id.toLowerCase();
          return !id.includes('embed') && !id.includes('moderation');
        })
        .map(m => ({
          id: `deepseek:${m.id}`,
          name: m.id,
          provider: 'deepseek' as const,
          description: `Owned by: ${m.owned_by}`,
          isLocal: false
        }));

      // Sort deepseek-v4-pro to the absolute top
      models.sort((a, b) => {
        if (a.id === 'deepseek:deepseek-v4-pro') return -1;
        if (b.id === 'deepseek:deepseek-v4-pro') return 1;
        if (a.id === 'deepseek:deepseek-reasoner') return -1;
        if (b.id === 'deepseek:deepseek-reasoner') return 1;
        return 0;
      });
      return models;
    } catch (error: unknown) {
      console.warn('[DeepSeekProvider] Could not fetch models from DeepSeek:', error);
      // Fallback model list
      return [
        { id: 'deepseek:deepseek-v4-pro', name: 'deepseek-v4-pro', provider: 'deepseek', isLocal: false, description: 'DeepSeek Flagship Professional reasoning & chat model' },
        { id: 'deepseek:deepseek-v4-flash', name: 'deepseek-v4-flash', provider: 'deepseek', isLocal: false, description: 'DeepSeek Low-latency fast chat model' },
        { id: 'deepseek:deepseek-chat', name: 'deepseek-chat', provider: 'deepseek', isLocal: false, description: 'DeepSeek Chat Model (legacy/alias)' },
        { id: 'deepseek:deepseek-reasoner', name: 'deepseek-reasoner', provider: 'deepseek', isLocal: false, description: 'DeepSeek Reasoning Model (legacy/alias)' }
      ];
    }
  }
}
