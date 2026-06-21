export function formatTools(tools: any[]): string {
  return tools.map(t => 
    `### Tool: ${t.name}\n**Description:**\n${t.description}\n\n**Parameters:**\n\`\`\`json\n${JSON.stringify(t.parameters, null, 2)}\n\`\`\``
  ).join('\n\n');
}
