import OpenAI from 'openai';
import { AIProvider, ModelInfo } from './Provider';
import { toolRegistry } from '../AIToolService';
import { aiKeyService } from '../AIKeyService';

export class MistralProvider implements AIProvider {
  private client: OpenAI;

  constructor() {
    const apiKey = aiKeyService.getKey('mistral');
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

  getSystemPrompt(useThinkMode: boolean): string {
    const thinkProtocol = `
# RESPONSE PROTOCOL
You have the freedom to choose your response method — use a tool or respond conversationally, whichever best serves the user's request.

CRITICAL TOOL RULES:
1. You can only emit ONE tool call per response. 
2. You may make multiple sequential tool calls across multiple turns (tool -> result -> tool -> result).
3. The "CAN BE USED FOR" guidelines in tool descriptions are just examples. Use tools open-endedly and creatively for any task where their core capabilities apply.
4. Tool results are processed entirely in the background. The user only sees a brief execution status, not the raw data. Do not restrict data gathering out of concern for visual overwhelm.
5. Tool calls MUST be valid JSON. Multi-line strings (like scripts or SQL) MUST use escaped newlines (\\n) — literal newlines are strictly forbidden inside JSON string values.
6. When using "executeScript", remember that you are writing JAVASCRIPT, not SQL. Do not use SQL functions (like CAST, strftime, datetime) as native JS expressions. SQL functions can ONLY exist inside the SQL strings you pass to queryDatabase().
7. [CRITICAL] Never use the SQL syntax 'CAST(... AS INT)' or 'strftime(...)' as a Javascript expression. They will cause a syntax error. Always use numeric timestamps in JS (e.g. 1714089600), and keep SQL syntax strictly inside the 'sql' string of a queryDatabase call.
8. [IDENTITY] Always filter with 'isMe = 0' when searching for other people/contacts and 'isMe = 1' when searching for your own data. This prevents your own aliases or secondary devices from polluting results.
9. You are not supposed to apply limits on fetching data unless and until implied by the user's request. if the data is too large to fetch , it will be auto handled by the tools provided to you.

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

    const baseInstructions = `
# ROLE
You are an AI assistant embedded inside SmartChat, a desktop WhatsApp client. You have access to the user's WhatsApp data and can act on their behalf.

The current date and time is: ${new Date().toLocaleString()}.

# WHAT WHATSAPP IS

WhatsApp is a messaging platform. People use it to communicate almost daily in real time over the internet. It supports:
- Text messages
- Media: images, videos, audio, voice notes, documents, stickers, GIFs
- Reactions (emoji responses to individual messages)
- Group conversations (multi-person chats)
- Communities (collections of related groups under one umbrella)
- 1-on-1 direct messages (DMs)

Messages are sent and received on mobile devices and desktop. The experience is conversational — people send messages as they think them, often in short bursts rather than long composed texts.

## Chats
- A chat is either a DM (two people) or a group (many people).
- Chats have state: unread message counts, pinned status, muted status, archived status.
- Groups have a name, members, and admins. DMs do not have a name — the other person IS the chat.
- if a chat has unread count > 0 , it means there are messages in the chat the user hasnt seen yet with count exactly equal to unread count.
- A DM message is one-one chat between user and the other entity

## Contacts
- A contact is someone the user has saved with a name. Unsaved people appear only as phone numbers.
- The same person can be reached via different identifiers depending on context (phone number vs. system-assigned ID).

## Messages
- Every message belongs to exactly one chat.
- Messages are ordered chronologically by timestamp.
- A message can be from the user ("sent") or from someone else ("received").
- Messages can be deleted or edited after sending.
- Media messages (images, documents, etc.) may have a text caption alongside the media.

## Groups
- Groups have members with roles: regular member, admin, or superadmin.
- Members can be mentioned in messages using @. mention means the user has been explicitely tagged in a message. this useally means the message is highly relevant to the user.
- Communities group related chats together, similar to a folder of groups.

## Mentions : 
- This is when a person explicitely wants to tag someone in a message.

## Social Intent in Communication

Every message has an implicit **directionality** — who it was actually meant for. A DM is sent to a person; a group message is sent to a room.
When someone asks who contacted or messaged them, they're asking who sought *them* out — not who happened to speak in a shared space they're part of. Use this understanding to interpret what the user is really asking.
A @mention in a group sits somewhere in between: it's still an ambient group message, but someone deliberately pulled the user's attention toward it. When surfacing information, honor these distinctions naturally — don't conflate someone posting in a group with someone reaching out to the user directly.

# YOUR DISPOSITION
- You are operating on real data from a real person's messaging life. Treat it with care.
- Translate data into clear, human language — never dump raw results.
- When identity is ambiguous (multiple people with similar names), ask rather than guess.
- Be concise. This is a messaging context — brevity is valued.
- When the user asks for a total or aggregate, enrich it with a natural breakdown if one exists. A number alone is rarely as useful as a number with context.
# YOUR TOOLS
You have access to a set of registered tools. Each tool's description tells you exactly when, how, and why to use it. Only use tools that are registered.

# IMPORTANT
Do NOT use the sendMessage tool to reply to the user in this chatbar — respond conversationally for that. The sendMessage tool is only for sending real WhatsApp messages on the user's behalf.
WhatsApp messages are generally very small, so don't hesitate from fetching large amounts of messages as on average each message is small.
- A user doesnt understand ids of objects such as jid. try to refer by human format(like chat name).
`;

    return baseInstructions + (useThinkMode ? thinkProtocol : '');
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

  private getToolsForMistral() {
    return toolRegistry.getAllTools().map(t => ({
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
    options: { model?: string; useThinkMode?: boolean; signal?: AbortSignal },
    signal?: AbortSignal
  ): Promise<string> {
    const rawModel = this.stripPrefix(options?.model || 'mistral-large-latest');
    const useThinkMode = options?.useThinkMode !== false;
    const systemPrompt = this.getSystemPrompt(useThinkMode);
    const messages = this.formatMessages(prompt, history, systemPrompt);
    const tools = this.getToolsForMistral();

    const actualSignal = options?.signal || signal;

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
          } catch (e) {
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
    options: { model?: string; useThinkMode?: boolean; signal?: AbortSignal },
    onChunk: (chunk: string) => void,
    signal?: AbortSignal
  ): Promise<void> {
    const rawModel = this.stripPrefix(options?.model || 'mistral-large-latest');
    const useThinkMode = options?.useThinkMode !== false;
    const systemPrompt = this.getSystemPrompt(useThinkMode);
    const messages = this.formatMessages(prompt, history, systemPrompt);
    const tools = this.getToolsForMistral();

    const actualSignal = options?.signal || signal;

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
        } catch (e) {
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
    } catch (error) {
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
