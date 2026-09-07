import { describe, it, expect, vi } from 'vitest';
import { ExecuteScriptTool } from '../../tools/ExecuteScriptTool';
import type { AITool, IToolRegistry, ToolResult } from '../../services/ai/IToolRegistry';

function makeRegistry(tools: AITool[]): IToolRegistry {
  return {
    registerTool: vi.fn(),
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
    vi.useFakeTimers();
    let echoCalls = 0;
    let resolveSlow: () => void = () => {};
    const slowTool: AITool = {
      name: 'slow',
      description: 'never resolves until we say so',
      parametersSchema: { type: 'object' },
      requiresPermission: false,
      execute: () => new Promise<ToolResult>((res) => { resolveSlow = () => res({ text: '{}' }); })
    };
    const countingEcho: AITool = {
      ...echoTool,
      execute: async (args: Record<string, unknown>): Promise<ToolResult> => {
        echoCalls++;
        return { text: JSON.stringify({ echoed: args }) };
      }
    };

    const tool = new ExecuteScriptTool(makeRegistry([slowTool, countingEcho]));
    const resPromise = tool.execute({
      script: `await slow(); await echo({ after: 'timeout' }); return 'done';`,
      explanation: 'test'
    });

    // Let the script start and enter `await slow()`.
    await vi.advanceTimersByTimeAsync(1);
    // Fire the 60s wall-clock timeout.
    await vi.advanceTimersByTimeAsync(60_000);

    const res = JSON.parse((await resPromise).text) as { success: boolean; timedOut?: boolean };
    expect(res.success).toBe(false);
    expect(res.timedOut).toBe(true);

    // The orphaned script now resumes — its next tool call must be rejected.
    resolveSlow();
    await vi.advanceTimersByTimeAsync(1);
    await Promise.resolve();
    expect(echoCalls).toBe(0);

    vi.useRealTimers();
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
