import { AITool, IToolRegistry } from '../services/ai/IToolRegistry';
import { runScriptInChild } from './ExecuteScriptRunner';

const MAX_EXECUTION_MS = 60_000; // 60 second wall-clock timeout
const MAX_TOOL_CALLS = 10000;       // prevent runaway loops

const DESCRIPTION_BASE = `Write and execute a JavaScript program that can call registered tools with full control flow — loops, conditionals, variables, and any standard JS logic.

CAN BE USED FOR:
- Workflows that require control flow (example:loops, conditionals)
- Tasks requiring multiple sequential tool calls
- Batch operations
- Data aggregation and transformation
- Programmatic data generation and text manipulation
- Mathematical and deterministic calculations
- Data filtering, sorting, and regex parsing
- Piping output from one tool as dynamic input to another

NOTE: If a task requires multiple tools or iteration, prefer handling it entirely inside a single script rather than splitting it across turns.

HOW TO WRITE THE SCRIPT:
- All tool calls MUST use 'await' (they are async). Forgetting 'await' returns a Promise, not a result.
- Available tools are injected as global async functions — call them by name directly.
- Your script runs inside an async IIFE. Use 'return' at the top level to emit a final result.
- If you define a named async function, call it with \`return await main()\` to ensure the IIFE waits for it and captures its return value.
- console.log() is captured and returned in the output under 'logs'.
- Forgetting \`await\` returns a Promise, not a result. Forgetting \`return await\` on a named async function means the script exits before it finishes.

WHAT YOU RECEIVE BACK:
{
  success: true | false,
  result: <your return value>,        // present on success
  logs: ["[log] ...", "[tool:name] call #1", ...],
  toolCallCount: N,
  error: "<message>",                 // present on failure
  timedOut: true                      // present only if the wall-clock was hit
}
If success is false, read 'error' and 'logs' to diagnose — then retry with a corrected script.

EXAMPLES(YOU MUST ADHERE TO THESE PATTERNS):

User: "find me the syllabus for CN endsem"

<thought>
The user is looking for specific information. A simple search might return isolated messages without enough context to verify if it's the right one. I will write a script to first find the matching messages, and then fetch a window of surrounding messages for each match to provide better context. To prevent redundant data, I'll ensure deduplication of the contextual messages. I'll use groupByChat: true so results from the same chat are shown together cleanly. If this initial context isn't enough, I can fetch a larger window in the next turn.
</thought>
<tool_call>
{
  "tool": "executeScript",
  "arguments": {
    "script": "const matches = await queryDatabase({\\n  sql: \\"SELECT id, chatJid, timestamp FROM Message WHERE (textContent LIKE '%syllabus%' OR content LIKE '%syllabus%') AND (textContent LIKE '%CN%' OR textContent LIKE '%Computer Network%' OR content LIKE '%CN%' OR content LIKE '%Computer Network%') ORDER BY timestamp DESC\\",\\n  explanation: \\"Find messages matching CN syllabus\\"\\n});\\n\\nconst seenIds = new Set();\\n\\nfor (const match of matches.rows) {\\n  const window = await queryDatabase({\\n    sql: \\"SELECT id FROM Message WHERE chatJid = ? AND timestamp >= ? - 86400 AND timestamp <= ? + 86400 ORDER BY timestamp ASC LIMIT 20\\",\\n    params: [match.chatJid, match.timestamp, match.timestamp],\\n    explanation: \\"Fetch context message IDs around match\\"\\n  });\\n  \\n  for (const row of window.rows) {\\n    seenIds.add(row.id);\\n  }\\n}\\n\\nconst idList = Array.from(seenIds);\\nif (idList.length === 0) return \\"No messages found.\\";\\nreturn await readMessages({\\n  sql: \\"SELECT id FROM Message WHERE id IN (\\" + idList.map(() => \\"?\\").join(\\",\\") + \\")\\" ,\\n  params: idList,\\n  groupByChat: true\\n});",
    "explanation": "Search for CN syllabus, aggregate surrounding message IDs, and format them grouped by chat using readMessages."
  }
}
</tool_call>

 

AVAILABLE TOOLS (injected as globals):
`;

const MSG_NO_RETURN_VALUE = '(script completed with no return value)';

// ── Tool ───────────────────────────────────────────────────────────────────────

export class ExecuteScriptTool implements AITool {
  name = 'executeScript';
  requiresPermission = true;

  description: string = DESCRIPTION_BASE + '(initializing — tool list not yet available)';

  constructor(
    private readonly toolRegistry: IToolRegistry,
    private readonly maxExecutionMs: number = MAX_EXECUTION_MS
  ) {}

  parametersSchema = {
    type: 'object',
    properties: {
      script: {
        type: 'string',
        description: 'Valid JavaScript code. Use "await" for every tool call. Use "return" to emit a final result. Top-level await is supported.'
      },
      explanation: {
        type: 'string',
        description: 'Plain-English description of what this script does. Shown to the user before execution.'
      }
    },
    required: ['script', 'explanation']
  };

  // ── Lifecycle ──────────────────────────────────────────────────────────────

  async initialize(): Promise<void> {
    // Build the tool list AFTER all tools are registered (called from AIToolInitializer)
    const injectedTools = this.toolRegistry
      .getAllTools()
      .filter(t => t.name !== this.name) // no recursive script execution
      .map(t => t.name)
      .join(', ');

    this.description = DESCRIPTION_BASE + injectedTools;

    console.log(
      '[ExecuteScriptTool] Initialized. Injected tools:',
      injectedTools
    );
  }

  // ── Execution ──────────────────────────────────────────────────────────────

  async execute(args: unknown, ctx?: import('../services/ai/IToolRegistry').ToolExecutionContext): Promise<import('../services/ai/IToolRegistry').ToolResult> {
    if (!args || typeof args !== 'object') {
      throw new Error('[ExecuteScriptTool] Invalid arguments passed to ExecuteScriptTool');
    }
    const { script, explanation } = args as Record<string, unknown>;

    if (!script || typeof script !== 'string') {
      throw new Error('[ExecuteScriptTool] Missing required argument: script');
    }

    const logs: string[] = [];
    let toolCallCount = 0;
    // Flipped true when the wall-clock timeout fires, so the bridge refuses any
    // tool call that is still in flight when the script process is killed.
    let aborted = false;

    const bridge = this.buildBridge(
      logs,
      () => toolCallCount,
      () => {
        toolCallCount++;
      },
      () => aborted,
      ctx
    );
    const toolNames = this.toolRegistry
      .getAllTools()
      .map(t => t.name)
      .filter(n => n !== this.name);

    // The script runs in a separate process with no host bindings; see ExecuteScriptRunner.
    const outcome = await runScriptInChild({
      script,
      toolNames,
      bridge,
      timeoutMs: this.maxExecutionMs,
      onTimeout: () => {
        aborted = true;
      }
    });

    if (!outcome.ok) {
      const error =
        outcome.phase === 'syntax' ? `Syntax error: ${outcome.error}`
        : outcome.phase === 'boot' ? `Sandbox init failed: ${outcome.error}`
        : outcome.error;
      return {
        text: JSON.stringify({
          explanation,
          success: false,
          ...(outcome.phase === 'timeout' ? { timedOut: true } : {}),
          error,
          logs,
          toolCallCount
        }, null, 2),
        citations: ctx?.citationEmitter?.getEntries()
      };
    }

    const result: unknown = outcome.resultJson !== undefined ? JSON.parse(outcome.resultJson) : undefined;
    return {
      text: JSON.stringify({
        explanation,
        success: true,
        result: result !== undefined ? result : MSG_NO_RETURN_VALUE,
        logs,
        toolCallCount
      }, null, 2),
      citations: ctx?.citationEmitter?.getEntries()
    };
  }

  /**
   * Host-side handler for the one IPC call the script process can make. It
   * accepts and returns only strings; the script process never holds a host
   * object. The tool remains `requiresPermission = true` and must not be exposed
   * on unauthenticated surfaces (see the HTTP tools controller).
   */
  private buildBridge(
    logs: string[],
    getCallCount: () => number,
    incrementCallCount: () => void,
    isAborted: () => boolean,
    ctx?: import('../services/ai/IToolRegistry').ToolExecutionContext
  ): (op: string, payloadJson: string) => Promise<string> {
    return async (op: string, payloadJson: string): Promise<string> => {
      if (op === 'log') {
        try {
          const { level, msg } = JSON.parse(payloadJson) as { level: string; msg: string };
          logs.push(`[${level}] ${msg}`);
        } catch {
          /* ignore malformed log payloads */
        }
        return '{}';
      }

      if (op !== 'tool') return JSON.stringify({ __scriptError__: true, message: `Unknown bridge op: ${op}` });

      if (isAborted()) {
        return JSON.stringify({
          __scriptError__: true,
          message: 'Script was aborted (wall-clock timeout reached); no further tool calls are permitted.'
        });
      }

      let name: string;
      let toolArgs: Record<string, unknown>;
      try {
        const payload = JSON.parse(payloadJson) as { name: string; args: string };
        name = payload.name;
        toolArgs = JSON.parse(payload.args) as Record<string, unknown>;
      } catch {
        return JSON.stringify({ __scriptError__: true, message: 'Malformed tool call payload' });
      }

      if (name === this.name) {
        return JSON.stringify({ __scriptError__: true, message: 'Recursive executeScript is not allowed' });
      }
      const tool = this.toolRegistry.getTool(name);
      if (!tool) {
        return JSON.stringify({ __scriptError__: true, message: `Unknown tool: ${name}` });
      }
      if (getCallCount() >= MAX_TOOL_CALLS) {
        return JSON.stringify({
          __scriptError__: true,
          message: `Tool call limit (${MAX_TOOL_CALLS}) reached. Script halted to prevent runaway execution.`
        });
      }
      incrementCallCount();
      logs.push(`[tool:${name}] call #${getCallCount()}`);

      try {
        const result = await tool.execute(toolArgs, ctx);
        // Tools already return a JSON string in `.text`; forward it verbatim so
        // the in-context JSON.parse reconstructs it with the context's own realm.
        if (result && typeof result.text === 'string') return result.text;
        return JSON.stringify(result ?? null);
      } catch (err: unknown) {
        return JSON.stringify({
          __scriptError__: true,
          message: err instanceof Error ? err.message : String(err)
        });
      }
    };
  }
}
