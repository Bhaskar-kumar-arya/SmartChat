export interface AITool {
  name: string;
  description: string;
  parametersSchema: object;
  requiresPermission: boolean;
  execute: (args: any) => Promise<any>;
  /** Optional async setup (e.g. DB introspection). Called once after registration. */
  initialize?: () => Promise<void>;
}

export class ToolRegistry {
  private tools: Map<string, AITool> = new Map();

  registerTool(tool: AITool) {
    this.tools.set(tool.name, tool);
  }

  getTool(name: string): AITool | undefined {
    return this.tools.get(name);
  }

  getAllTools(): AITool[] {
    return Array.from(this.tools.values());
  }

  getToolDefinitions(): any[] {
    return this.getAllTools().map(t => ({
      name: t.name,
      description: t.description,
      parameters: t.parametersSchema
    }));
  }

  getSystemInstructions(useThinkMode: boolean = true): string {
    const tools = this.getToolDefinitions();
    if (tools.length === 0) return '';

    const reactProtocol = `
# RESPONSE PROTOCOL
You have the freedom to choose your response method — use a tool or respond conversationally, whichever best serves the user's request. You may make multiple sequential tool calls before you have enough information to respond.

Every response MUST start with a <thought> block.
<thought>
Reason through the full situation before acting:
— What is the user truly asking for, considering the entire conversation history?
— Have I received any [SYSTEM] results? Did they succeed, and do they fully answer the user's need — or do I need to act further?
— If a tool failed, what exactly went wrong and what should I change?
— What is the best next action: use a tool, chain multiple tool calls, or respond directly?
— What would make the most complete, accurate, and helpful response?
</thought>

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
# RESPONSE PROTOCOL
You have the freedom to choose your response method — use a tool or respond conversationally, whichever best serves the user's request. You may make multiple sequential tool calls before you have enough information to respond.

When executing a tool, output ONLY the tool call XML — no other text.
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
# SYSTEM CONTEXT
You are an advanced, proactive AI agent embedded in "smartChat" — a modern WhatsApp-like desktop application.
The current time is: ${new Date().toLocaleString()}.

# MESSAGE ROLES
Every message in this conversation is prefixed to indicate its origin. Understand these labels strictly:
- [USER] — A direct message from the human user. This is your primary instruction.
- [AI] — Your own previous responses.
- [SYSTEM] — The output of a tool you called, or injected application context. Always treat this as ground truth data. A [SYSTEM] message appearing after your [AI] tool call IS that tool's result.

# YOUR TOOLS
You have access to a set of registered tools. Each tool's description tells you exactly when, how, and why to use it. Only use tools that are listed.
${JSON.stringify(tools, null, 2)}
${useThinkMode ? reactProtocol : standardProtocol}`;
  }
}

export const toolRegistry = new ToolRegistry();
