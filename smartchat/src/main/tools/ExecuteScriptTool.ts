import vm from 'vm';
import { AITool, toolRegistry } from '../services/AIToolService';

const MAX_EXECUTION_MS = 60_000; // 30 second wall-clock timeout
const MAX_TOOL_CALLS = 1000;       // prevent runaway loops

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
  timedOut: true                      // present only if the 30s wall-clock was hit
}
If success is false, read 'error' and 'logs' to diagnose — then retry with a corrected script.

EXAMPLE — mark all unread chats as read:
\`\`\`js
const result = await queryDatabase({
  sql: "SELECT jid FROM Chat WHERE unreadCount > 0",
  explanation: "Find all unread chats"
});
let count = 0;
for (const { jid } of result.rows) {
  await whatsAppAction({ action: 'markRead', jid });
  count++;
}
return \`Marked \${count} chats as read.\`;
\`\`\`

AVAILABLE TOOLS (injected as globals):
`;

// ── Tool ───────────────────────────────────────────────────────────────────────

export class ExecuteScriptTool implements AITool {
  name = 'executeScript';
  requiresPermission = true;

  description: string = DESCRIPTION_BASE + '(initializing — tool list not yet available)';

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
    const injectedTools = toolRegistry
      .getAllTools()
      .filter(t => t.name !== this.name) // no recursive script execution
      .map(t => {
        return `\n--- TOOL: ${t.name}(args) ---\n${t.description}\n`;
      })
      .join('\n');

    this.description = DESCRIPTION_BASE + injectedTools;

    console.log(
      '[ExecuteScriptTool] Initialized. Injected tools:',
      toolRegistry.getAllTools().filter(t => t.name !== this.name).map(t => t.name)
    );
  }

  // ── Execution ──────────────────────────────────────────────────────────────

  async execute(args: any): Promise<any> {
    const { script, explanation } = args;

    if (!script || typeof script !== 'string') {
      throw new Error('Missing required argument: script');
    }

    const logs: string[] = [];
    let toolCallCount = 0;

    // ── Build sandboxed context ────────────────────────────────────────────
    const sandbox: Record<string, any> = {
      // Safe JS built-ins only
      Promise,
      JSON,
      Math,
      Date,
      Array,
      Object,
      String,
      Number,
      Boolean,
      Set,
      Map,
      parseInt,
      parseFloat,
      isNaN,
      isFinite,
      console: {
        log: (...a: any[]) => logs.push('[log] ' + a.map(String).join(' ')),
        warn: (...a: any[]) => logs.push('[warn] ' + a.map(String).join(' ')),
        error: (...a: any[]) => logs.push('[error] ' + a.map(String).join(' ')),
      },
      // Explicitly block dangerous globals
      require: undefined,
      process: undefined,
      global: undefined,
      globalThis: undefined,
      Buffer: undefined,
      __dirname: undefined,
      __filename: undefined,
    };

    // Inject each registered tool as an async global (except ourselves)
    for (const tool of toolRegistry.getAllTools()) {
      if (tool.name === this.name) continue;

      sandbox[tool.name] = async (toolArgs: any) => {
        if (toolCallCount >= MAX_TOOL_CALLS) {
          throw new Error(
            `[executeScript] Tool call limit (${MAX_TOOL_CALLS}) reached. Script halted to prevent runaway execution.`
          );
        }
        toolCallCount++;
        logs.push(`[tool:${tool.name}] call #${toolCallCount}`);
        return tool.execute(toolArgs);
      };
    }

    const context = vm.createContext(sandbox);

    // Wrap script in an async IIFE so top-level 'await' and 'return' work
    const wrapped = `(async function __smartscript__() {\n${script}\n})()`;

    let scriptPromise: Promise<any>;
    try {
      const compiled = new vm.Script(wrapped, {
        filename: 'smartscript.js',
        lineOffset: -1  // offset so line numbers in errors match user's script
      });
      // runInContext returns a Promise (the IIFE result)
      scriptPromise = compiled.runInContext(context);
    } catch (syntaxErr: any) {
      return {
        explanation,
        success: false,
        error: `Syntax error: ${syntaxErr?.message || String(syntaxErr)}`,
        logs,
        toolCallCount
      };
    }

    // Race the script against a wall-clock timeout (handles async hangs)
    let result: any;
    let timedOut = false;

    try {
      result = await Promise.race([
        scriptPromise,
        new Promise<never>((_, reject) =>
          setTimeout(() => {
            timedOut = true;
            reject(new Error(`Script exceeded ${MAX_EXECUTION_MS / 1000}s timeout.`));
          }, MAX_EXECUTION_MS)
        )
      ]);
    } catch (err: any) {
      return {
        explanation,
        success: false,
        timedOut,
        error: err?.message || String(err),
        logs,
        toolCallCount
      };
    }

    return {
      explanation,
      success: true,
      result: result !== undefined ? result : '(script completed with no return value)',
      logs,
      toolCallCount
    };
  }
}
