import { AITool } from '../IToolRegistry'

export function formatTools(tools: AITool[]): string {
  return tools.map(t => 
    `### Tool: ${t.name}\n**Description:**\n${t.description}\n\n**Parameters:**\n\`\`\`json\n${JSON.stringify(t.parametersSchema, null, 2)}\n\`\`\``
  ).join('\n\n');
}
