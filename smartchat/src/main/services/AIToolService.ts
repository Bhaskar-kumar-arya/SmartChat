export interface AITool {
  name: string;
  description: string;
  parametersSchema: object;
  requiresPermission: boolean;
  execute: (args: any) => Promise<any>;
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

  getSystemInstructions(): string {
    const tools = this.getAllTools();
    if (tools.length === 0) return '';
    
    // Create a JSON describing the tools
    const toolDescriptions = tools.map(t => ({
      name: t.name,
      description: t.description,
      parameters: t.parametersSchema
    }));

    return `
You have access to the following tools:
${JSON.stringify(toolDescriptions, null, 2)}

To use a tool, you must output EXACTLY this format and nothing else. Ensure it is valid JSON inside the tags:
<tool_call>
{
  "tool": "toolName",
  "arguments": {
    "argName": "value"
  }
}
</tool_call>

General Guidelines:
1. When mentioning someone in a message (especially in groups), use the format "@ID" (the part of the JID before the @) in the text (e.g., @1234567890 or @207176874356812).
2. For tools that support a "mentions" parameter, you MUST also include the full WhatsApp JIDs (e.g., "1234567890@s.whatsapp.net" or "207176874356812@lid") of everyone you mentioned in the text in that array.
3. You can find participant JIDs and their names/IDs in the chat context or by using tools like 'readChat'.
`;
  }
}

export const toolRegistry = new ToolRegistry();
