import OpenAI from 'openai';
import { ModelInfo } from './IBaseAIProvider';
import { IApiKeyAwareProvider } from './IApiKeyAwareProvider';
import { IStreamingProvider } from './IStreamingProvider';
import { IFullResponseProvider } from './IFullResponseProvider';
import { IToolRegistry } from '../IToolRegistry';
import { IAIKeyService } from '../IAIKeyService';

export class MistralProvider implements IStreamingProvider, IFullResponseProvider, IApiKeyAwareProvider {
  private client: OpenAI;

  constructor(
    private readonly aiKeyService: IAIKeyService,
    private readonly toolRegistry: IToolRegistry
  ) {
    const apiKey = this.aiKeyService.getKey('mistral');
    const baseURL = process.env.MISTRAL_BASE_URL || 'https://api.mistral.ai/v1';
    this.client = new OpenAI({ apiKey, baseURL });
  }

  updateApiKey(apiKey: string): void {
    const baseURL = process.env.MISTRAL_BASE_URL || 'https://api.mistral.ai/v1';
    this.client = new OpenAI({ apiKey, baseURL });
  }

  canHandleModel(modelId: string): boolean {
    // Unambiguous routing via prefix
    return modelId.startsWith('mistral:');
  }



  async cleanup(): Promise<void> {
    // No local resources to unload
  }

  private formatMessages(
    prompt: string,
    history: Array<{ role: string; content: string }>,
    systemPrompt: string
  ): Array<{ role: 'user' | 'assistant' | 'system'; content: string }> {
    const messages: Array<{ role: 'user' | 'assistant' | 'system'; content: string }> = [];
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

  private getToolsForMistral(): Array<{ type: 'function'; function: { name: string; description: string; parameters: Record<string, unknown> } }> {
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
    return modelId.replace(/^mistral:/, '');
  }

  async generateResponse(
    prompt: string,
    history: Array<{ role: string; content: string }>,
    options: { model?: string; [key: string]: unknown },
    signal?: AbortSignal
  ): Promise<string> {
    const modelOption = typeof options?.model === 'string' ? options.model : 'mistral-large-latest';
    const rawModel = this.stripPrefix(modelOption);
    const systemPrompt = typeof options?.systemPrompt === 'string' ? options.systemPrompt : '';
    const messages = this.formatMessages(prompt, history, systemPrompt);
    const tools = this.getToolsForMistral();

    const optionsSignal = options?.signal instanceof AbortSignal ? options.signal : undefined;
    const actualSignal = optionsSignal || signal;

    const response = await this.client.chat.completions.create({
      model: rawModel,
      messages,
      tools: tools.length > 0 ? tools : undefined,
      temperature: 0.0,
    }, { signal: actualSignal });

    const message = response.choices[0]?.message;
    let finalResponse = message?.content || '';

    // Convert native tool calls to XML format if present
    if (message?.tool_calls && message.tool_calls.length > 0) {
      for (const tc of message.tool_calls) {
        if (tc.type === 'function' && tc.function.name) {
          let argsObj = {};
          try {
            argsObj = JSON.parse(tc.function.arguments);
          } catch (e: unknown) {
            console.warn('Failed to parse Mistral tool call arguments:', tc.function.arguments);
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
    const modelOption = typeof options?.model === 'string' ? options.model : 'mistral-large-latest';
    const rawModel = this.stripPrefix(modelOption);
    const systemPrompt = typeof options?.systemPrompt === 'string' ? options.systemPrompt : '';
    const messages = this.formatMessages(prompt, history, systemPrompt);
    const tools = this.getToolsForMistral();

    const optionsSignal = options?.signal instanceof AbortSignal ? options.signal : undefined;
    const actualSignal = optionsSignal || signal;

    const stream = await this.client.chat.completions.create({
      model: rawModel,
      messages,
      tools: tools.length > 0 ? tools : undefined,
      temperature: 0.0,
      stream: true
    }, { signal: actualSignal });

    const toolCalls: Array<{
      id: string
      type: 'function'
      function: { name: string; arguments: string }
    }> = [];

    for await (const chunk of stream) {
      if (actualSignal?.aborted) break;

      const delta = chunk.choices[0]?.delta;
      if (delta?.content) {
        onChunk(delta.content);
      }

      if (delta?.tool_calls) {
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

    // After stream completes, emit accumulated tool calls as XML chunks
    for (const tc of toolCalls) {
      if (tc && tc.function.name) {
        let argsObj = {};
        try {
          argsObj = JSON.parse(tc.function.arguments);
        } catch (e: unknown) {
          console.warn('Failed to parse Mistral streamed tool call arguments:', tc.function.arguments);
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
          return !id.includes('embed') && !id.includes('moderation') && !id.includes('guard');
        })
        .map(m => ({
          id: `mistral:${m.id}`,
          name: m.id,
          provider: 'mistral' as const,
          description: `Owned by: ${m.owned_by}`,
          isLocal: false
        }));

      models.sort((a, b) => {
        if (a.id === 'mistral:mistral-large-latest') return -1;
        if (b.id === 'mistral:mistral-large-latest') return 1;
        return 0;
      });
      return models;
    } catch (error: unknown) {
      console.warn('[MistralProvider] Could not fetch models from Mistral:', error);
      // Fallback model list
      return [
        { id: 'mistral:mistral-large-latest', name: 'mistral-large-latest', provider: 'mistral', isLocal: false, description: 'Mistral Large Flagship Model' },
        { id: 'mistral:codestral-2508', name: 'codestral-2508', provider: 'mistral', isLocal: false, description: 'Mistral Code Generation Model' },
        { id: 'mistral:pixtral-12b-2409', name: 'pixtral-12b-2409', provider: 'mistral', isLocal: false, description: 'Mistral Multimodal Model' }
      ];
    }
  }
}
