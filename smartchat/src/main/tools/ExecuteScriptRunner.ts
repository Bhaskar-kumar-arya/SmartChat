import { spawn, type ChildProcess } from 'child_process';

/**
 * Runs an executeScript program in a separate OS process that has no host
 * bindings: no tool registry, no DB, no Electron APIs. The only channel back to
 * the host is a JSON IPC protocol carrying the single `bridge(op, payload)` call.
 * A wall-clock timeout hard-kills the process, which (unlike an in-process `vm`
 * timer) also stops synchronous loops and microtask-starving loops.
 *
 * The child is started with `process.execPath -e <source>` rather than a file
 * path, so it needs no extra build entry and works from a packaged app. Under
 * Electron, `ELECTRON_RUN_AS_NODE=1` makes the binary behave as plain Node; plain
 * Node ignores it. The child gets an otherwise empty environment (no secrets).
 */

export type ScriptBridge = (op: string, payloadJson: string) => Promise<string>;

export type ScriptRunOutcome =
  | { ok: true; resultJson: string | undefined }
  | { ok: false; error: string; phase: 'boot' | 'syntax' | 'runtime' | 'timeout' | 'crash' };

export interface RunScriptOptions {
  script: string;
  toolNames: string[];
  bridge: ScriptBridge;
  timeoutMs: number;
  /** Called synchronously right before the child is killed on timeout. */
  onTimeout: () => void;
}

// Plain JS (CommonJS) executed by the child. Messages:
//   host -> child: {type:'run', script, toolNames} | {type:'bridge-result', id, result}
//   child -> host: {type:'bridge', id, op, payload} | {type:'done', ok, resultJson?, error?, phase?}
const CHILD_SOURCE = String.raw`
'use strict';
const vm = require('vm');
const pending = new Map();
let seq = 0;
function hostBridge(op, payload) {
  return new Promise((resolve) => {
    const id = ++seq;
    pending.set(id, resolve);
    process.send({ type: 'bridge', id: id, op: op, payload: payload });
  });
}
function done(m) { process.send(Object.assign({ type: 'done' }, m), () => process.exit(0)); }
const BOOTSTRAP = ${'`'}
"use strict";
const __B = __bridge__;
const __names = __toolNames__;
try { Error.prepareStackTrace = undefined; } catch (e) {}
try {
  Object.defineProperty(globalThis, 'constructor', {
    value: Object, writable: true, configurable: true, enumerable: false
  });
} catch (e) {}
globalThis.console = {
  log:   function () { __B('log', JSON.stringify({ level: 'log',   msg: Array.prototype.map.call(arguments, String).join(' ') })); },
  warn:  function () { __B('log', JSON.stringify({ level: 'warn',  msg: Array.prototype.map.call(arguments, String).join(' ') })); },
  error: function () { __B('log', JSON.stringify({ level: 'error', msg: Array.prototype.map.call(arguments, String).join(' ') })); },
};
async function __callTool(name, args) {
  let argJson;
  try { argJson = JSON.stringify(args === undefined ? {} : args); }
  catch (e) { throw new Error('Tool arguments for "' + name + '" are not JSON-serialisable'); }
  const raw = await __B('tool', JSON.stringify({ name: name, args: argJson }));
  let parsed;
  try { parsed = JSON.parse(raw); } catch (e) { return raw; }
  if (parsed && parsed.__scriptError__ === true) { throw new Error(String(parsed.message)); }
  return parsed;
}
for (let i = 0; i < __names.length; i++) {
  (function (n) { globalThis[n] = function (args) { return __callTool(n, args); }; })(__names[i]);
}
${'`'};
async function run(msg) {
  const context = vm.createContext(Object.create(null), { codeGeneration: { strings: true, wasm: false } });
  try {
    vm.compileFunction(BOOTSTRAP, ['__bridge__', '__toolNames__'], { parsingContext: context })(hostBridge, msg.toolNames);
  } catch (e) { return done({ ok: false, phase: 'boot', error: String(e && e.message || e) }); }
  let promise;
  try {
    const compiled = new vm.Script('(async function __smartscript__() {\n' + msg.script + '\n})()', {
      filename: 'smartscript.js', lineOffset: -1
    });
    promise = compiled.runInContext(context);
  } catch (e) { return done({ ok: false, phase: 'syntax', error: String(e && e.message || e) }); }
  try {
    const value = await promise;
    done({ ok: true, resultJson: value === undefined ? undefined : JSON.stringify(value) });
  } catch (e) { done({ ok: false, phase: 'runtime', error: String(e && e.message || e) }); }
}
process.on('message', (msg) => {
  if (msg.type === 'run') run(msg);
  else if (msg.type === 'bridge-result') {
    const r = pending.get(msg.id);
    if (r) { pending.delete(msg.id); r(msg.result); }
  }
});
`;

export function runScriptInChild(opts: RunScriptOptions): Promise<ScriptRunOutcome> {
  return new Promise<ScriptRunOutcome>((resolve) => {
    let settled = false;
    let child: ChildProcess;

    const finish = (outcome: ScriptRunOutcome): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (child && !child.killed) child.kill('SIGKILL');
      resolve(outcome);
    };

    try {
      child = spawn(process.execPath, ['-e', CHILD_SOURCE], {
        stdio: ['ignore', 'ignore', 'ignore', 'ipc'],
        env: { ELECTRON_RUN_AS_NODE: '1' },
        windowsHide: true
      });
    } catch (err: unknown) {
      resolve({ ok: false, phase: 'boot', error: err instanceof Error ? err.message : String(err) });
      return;
    }

    const timer = setTimeout(() => {
      opts.onTimeout();
      finish({
        ok: false,
        phase: 'timeout',
        error: `[ExecuteScriptTool] Script exceeded ${opts.timeoutMs / 1000}s timeout.`
      });
    }, opts.timeoutMs);

    child.on('error', (err) => finish({ ok: false, phase: 'boot', error: err.message }));
    child.on('exit', (code, signal) =>
      finish({ ok: false, phase: 'crash', error: `Script process exited unexpectedly (${signal ?? code})` })
    );
    child.on('message', (raw: unknown) => {
      const msg = raw as {
        type?: string;
        id?: number;
        op?: string;
        payload?: string;
        ok?: boolean;
        resultJson?: string;
        error?: string;
        phase?: 'boot' | 'syntax' | 'runtime';
      };
      if (msg.type === 'bridge' && typeof msg.id === 'number') {
        const id = msg.id;
        opts
          .bridge(String(msg.op), String(msg.payload))
          .catch((e: unknown) =>
            JSON.stringify({ __scriptError__: true, message: e instanceof Error ? e.message : String(e) })
          )
          .then((result) => {
            if (!settled && child.connected) child.send({ type: 'bridge-result', id, result });
          });
      } else if (msg.type === 'done') {
        finish(
          msg.ok
            ? { ok: true, resultJson: msg.resultJson }
            : { ok: false, phase: msg.phase ?? 'runtime', error: msg.error ?? 'Unknown script error' }
        );
      }
    });

    child.send({ type: 'run', script: opts.script, toolNames: opts.toolNames });
  });
}
