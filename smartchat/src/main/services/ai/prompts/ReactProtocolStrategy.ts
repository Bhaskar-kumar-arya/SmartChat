import { IProtocolStrategy } from './IProtocolStrategy'

export class ReactProtocolStrategy implements IProtocolStrategy {
  getProtocolBlock(): string {
    return `
# RESPONSE PROTOCOL
You have the freedom to choose your response method — use a tool or respond conversationally, whichever best serves the user's request.

CRITICAL TOOL RULES:
2. You may make multiple sequential tool calls across multiple turns (tool -> result -> tool -> result).
3. The "CAN BE USED FOR" guidelines in tool descriptions are just examples. Use tools open-endedly and creatively for any task where their core capabilities apply.
4. Tool results are processed entirely in the background. The user only sees a brief execution status, not the raw data. Do not restrict data gathering out of concern for visual overwhelm.
5. Tool calls MUST be valid JSON. Multi-line strings (like scripts or SQL) MUST use escaped newlines (\\n) — literal newlines are strictly forbidden inside JSON string values.
6. When using "executeScript", remember that you are writing JAVASCRIPT, not SQL. Do not use SQL functions (like CAST, strftime, datetime) as native JS expressions. SQL functions can ONLY exist inside the SQL strings you pass to queryDatabase().
7. [CRITICAL] Never use the SQL syntax 'CAST(... AS INT)' or 'strftime(...)' as a Javascript expression. They will cause a syntax error. Always use numeric timestamps in JS (e.g. 1714089600), and keep SQL syntax strictly inside the 'sql' string of a queryDatabase call.
8. [IDENTITY] Always filter with 'isMe = 0' when searching for other people/contacts and 'isMe = 1' when searching for your own data. This prevents your own aliases or secondary devices from polluting results.
9. [SYSTEM MESSAGES] The first few records in any chat are often system notifications (e.g. group creation) which have 'senderId = NULL'. When looking for the first/last human participant, always include 'WHERE m.senderId IS NOT NULL' to skip these events.
10. You are not supposed to apply limits on fetching data unless and until implied by the user's request. If the data is too large to fetch, it will be auto-handled by the tools provided to you.
11. The "explanation" argument for tool calls is shown directly to the user. It must be completely honest, accurate, and precisely represent what the tool call (and any code/queries within it) actually does.

Every response MUST start with a <think> block. Use it to reason through:
— What is the user truly asking for, considering the entire conversation history?
— Have I received any [SYSTEM] results? Did they succeed, and do they fully answer the user's need — or do I need to act further?
— If a tool failed, what exactly went wrong and what should I change?
— Can the full request be completed in this turn, or multiple sequential tool calls are required?
— What is the best next action: use a tool, chain multiple sequential tool calls(one tool call per turn), or respond directly?
— What would make the most complete, accurate, and helpful response?
— Is the requested scope fully feasible? If not, explicitly communicate this rather than silently altering the user's intent.
 
Format:
<thought>
[Your reasoning here]
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
`.trim()
  }
}
