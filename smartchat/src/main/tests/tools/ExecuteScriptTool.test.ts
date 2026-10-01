import { describe, it, expect, vi } from 'vitest';
import { ExecuteScriptTool } from '../../tools/ExecuteScriptTool';
import type { AITool, IToolRegistry, ToolResult } from '../../services/ai/IToolRegistry';

function makeRegistry(tools: AITool[]): IToolRegistry {
  return {
    registerTool: vi.fn(),
    unregisterTool: vi.fn(),
    getTool: (name: string) => tools.find(t => t.name === name),
    getAllTools: () => tools,
    getToolDefinitions: () => []
  };
}

const echoTool: AITool = {
  name: 'echo',
  description: 'echoes its args back',
  parametersSchema: { type: 'object' },
  requiresPermission: false,
  execute: async (args: Record<string, unknown>): Promise<ToolResult> => ({
    text: JSON.stringify({ echoed: args })
  })
};

const boomTool: AITool = {
  name: 'boom',
  description: 'always throws',
  parametersSchema: { type: 'object' },
  requiresPermission: false,
  execute: async (): Promise<ToolResult> => {
    throw new Error('kaboom');
  }
};

async function run(tool: ExecuteScriptTool, script: string) {
  const res = await tool.execute({ script, explanation: 'test' });
  return JSON.parse(res.text) as {
    success: boolean;
    result?: unknown;
    error?: string;
    logs: string[];
    toolCallCount: number;
  };
}

describe('ExecuteScriptTool sandbox hardening (S12-03)', () => {
  it('does not let a script reach the host realm via constructor.constructor', async () => {
    const tool = new ExecuteScriptTool(makeRegistry([echoTool]));
    const script = `
      const attempts = [];
      try { attempts.push(String(this.constructor.constructor('return typeof process')())); }
      catch (e) { attempts.push('throw:' + e.name); }
      try { attempts.push(String([].constructor.constructor('return typeof process')())); }
      catch (e) { attempts.push('throw:' + e.name); }
      try { attempts.push(String(echo.constructor.constructor('return typeof process')())); }
      catch (e) { attempts.push('throw:' + e.name); }
      return attempts;
    `;
    const out = await run(tool, script);
    expect(out.success).toBe(true);
    // Every attempt must resolve to "undefined" (process not defined in the
    // context) or a thrown error — never the host's "object".
    expect(out.result as string[]).toHaveLength(3);
    for (const a of out.result as string[]) {
      expect(a === 'undefined' || a.startsWith('throw:')).toBe(true);
    }
  });

  it('blocks require / Buffer / global in the script realm', async () => {
    const tool = new ExecuteScriptTool(makeRegistry([]));
    const out = await run(
      tool,
      `return [typeof require, typeof Buffer, typeof process, typeof global];`
    );
    expect(out.success).toBe(true);
    expect(out.result).toEqual(['undefined', 'undefined', 'undefined', 'undefined']);
  });

  it('still runs tools and marshals JSON results back to the script', async () => {
    const tool = new ExecuteScriptTool(makeRegistry([echoTool]));
    const out = await run(
      tool,
      `const r = await echo({ a: 1, b: 'x' }); console.log('got', r.echoed.a); return r;`
    );
    expect(out.success).toBe(true);
    expect(out.result).toEqual({ echoed: { a: 1, b: 'x' } });
    expect(out.toolCallCount).toBe(1);
    expect(out.logs).toContain('[log] got 1');
    expect(out.logs).toContain('[tool:echo] call #1');
  });

  it('refuses further tool calls after the wall-clock timeout fires (S12-04)', async () => {
    let echoCalls = 0;
    let resolveSlow: () => void = () => {};
    let slowEntered: () => void = () => {};
    const slowStarted = new Promise<void>((res) => { slowEntered = res; });
    const slowTool: AITool = {
      name: 'slow',
      description: 'never resolves until we say so',
      parametersSchema: { type: 'object' },
      requiresPermission: false,
      execute: () => new Promise<ToolResult>((res) => { slowEntered(); resolveSlow = () => res({ text: '{}' }); })
    };
    const countingEcho: AITool = {
      ...echoTool,
      execute: async (args: Record<string, unknown>): Promise<ToolResult> => {
        echoCalls++;
        return { text: JSON.stringify({ echoed: args }) };
      }
    };

    const tool = new ExecuteScriptTool(makeRegistry([slowTool, countingEcho]), 1500);
    const resPromise = tool.execute({
      script: `await slow(); await echo({ after: 'timeout' }); return 'done';`,
      explanation: 'test'
    });
    await slowStarted;

    const res = JSON.parse((await resPromise).text) as { success: boolean; timedOut?: boolean };
    expect(res.success).toBe(false);
    expect(res.timedOut).toBe(true);

    // The script process is killed: letting the pending tool resolve must not
    // lead to any further tool call.
    resolveSlow();
    await new Promise((r) => setTimeout(r, 200));
    expect(echoCalls).toBe(0);
  });

  it('surfaces a tool error as a catchable script error, not a host object', async () => {
    const tool = new ExecuteScriptTool(makeRegistry([boomTool]));
    const out = await run(
      tool,
      `try { await boom({}); return 'no-throw'; } catch (e) { return 'caught:' + e.message; }`
    );
    expect(out.success).toBe(true);
    expect(out.result).toBe('caught:kaboom');
  });
});

describe('ExecuteScriptTool isolation (S-02, B-AI-01 / B-AI-02)', () => {
  // The sandbox global inherits from the host Object.prototype, so walking its
  // prototype chain reaches the host Function and from there the host `process`.
  // Each probe returns what the escaped code saw; it must never be a host object.
  it('does not expose the host realm via the prototype of the sandbox global', async () => {
    const tool = new ExecuteScriptTool(makeRegistry([]));
    const out = await run(
      tool,
      `
      const probes = [
        () => Object.getPrototypeOf(globalThis).constructor.constructor('return typeof process')(),
        () => globalThis.__proto__.constructor.constructor('return typeof process')(),
      ];
      return probes.map((p) => { try { return String(p()); } catch (e) { return 'throw:' + e.name; } });
      `
    );
    expect(out.success).toBe(true);
    expect(out.result as string[]).toHaveLength(2);
    for (const a of out.result as string[]) {
      expect(a === 'undefined' || a.startsWith('throw:')).toBe(true);
    }
  });

  it('interrupts a synchronous infinite loop and reports timedOut', async () => {
    const tool = new ExecuteScriptTool(makeRegistry([]), 300);
    const started = Date.now();
    const out = (await run(tool, `while (true) {}`)) as { success: boolean; timedOut?: boolean };
    expect(out.success).toBe(false);
    expect(out.timedOut).toBe(true);
    expect(Date.now() - started).toBeLessThan(5000);
  });

  it('times out an async hang (never-settling promise) via the wall-clock race', async () => {
    const tool = new ExecuteScriptTool(makeRegistry([]), 200);
    const out = (await run(tool, `await new Promise(() => {}); return 1;`)) as { success: boolean; timedOut?: boolean };
    expect(out.success).toBe(false);
    expect(out.timedOut).toBe(true);
  });

  it('kills a script that starves the event loop with an endless microtask chain', async () => {
    const tool = new ExecuteScriptTool(makeRegistry([]), 500);
    const started = Date.now();
    const out = (await run(tool, `while (true) { await null; }`)) as { success: boolean; timedOut?: boolean };
    expect(out.success).toBe(false);
    expect(out.timedOut).toBe(true);
    expect(Date.now() - started).toBeLessThan(5000);
  });

  it('runs the script without host bindings or host secrets', async () => {
    process.env.S02_HOST_SECRET = 'host-only';
    try {
      const tool = new ExecuteScriptTool(makeRegistry([echoTool]));
      const out = await run(
        tool,
        `
        const probes = [
          () => typeof process, () => typeof require, () => typeof module,
          () => echo.constructor.constructor('return typeof process')(),
          () => Object.getPrototypeOf(globalThis).constructor.constructor('return typeof process')(),
        ];
        return probes.map((p) => { try { return String(p()); } catch (e) { return 'throw:' + e.name; } });
        `
      );
      expect(out.success).toBe(true);
      expect(out.result).toEqual(['undefined', 'undefined', 'undefined', 'undefined', 'undefined']);
    } finally {
      delete process.env.S02_HOST_SECRET;
    }
  });

  it('reports syntax errors and uncaught script errors without crashing the host', async () => {
    const tool = new ExecuteScriptTool(makeRegistry([]));
    const syn = await run(tool, `return (;`);
    expect(syn.success).toBe(false);
    expect(syn.error).toMatch(/^Syntax error:/);
    const thrown = await run(tool, `throw new Error('nope');`);
    expect(thrown.success).toBe(false);
    expect(thrown.error).toBe('nope');
  });
});
