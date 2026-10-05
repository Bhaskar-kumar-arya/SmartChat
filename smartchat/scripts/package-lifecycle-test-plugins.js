// Builds the .scext variants used by smoke item 21 (F-KRN-2) into plugins/lifecycle-test/.
const fs = require('fs')
const os = require('os')
const path = require('path')
const { packagePlugin } = require('../packages/sdk/dist/cli/package')

const outDir = path.join(__dirname, '../plugins/lifecycle-test')
fs.mkdirSync(outDir, { recursive: true })

const workingIndex = (version) => `
const { parentPort } = require('node:worker_threads');
const { WorkerPluginRuntime } = require('@smartchat/sdk');
const manifest = require('./manifest.json');
const ctx = new WorkerPluginRuntime(parentPort, manifest).getContext();
const VERSION = ${JSON.stringify(version)};
ctx.onActivate(async () => {
  const marker = await ctx.storage.get('marker');
  const count = (await ctx.storage.get('activations')) || 0;
  ctx.log.info('[lifecycle-test] ACTIVATE version=' + VERSION + ' pid-thread=' + process.pid + ' marker=' + marker + ' activations=' + count);
  ctx.ui.toast('lifecycle-test v' + VERSION + ' running; old marker=' + marker + '; activations=' + count, 'info');
  await ctx.storage.set('marker', 'written-by-v' + VERSION);
  await ctx.storage.set('activations', count + 1);
});
ctx.onDeactivate(async () => { ctx.log.info('[lifecycle-test] DEACTIVATE version=' + VERSION); });
`

const throwingIndex = `
const { parentPort } = require('node:worker_threads');
const { WorkerPluginRuntime } = require('@smartchat/sdk');
const manifest = require('./manifest.json');
const ctx = new WorkerPluginRuntime(parentPort, manifest).getContext();
ctx.onActivate(async () => { throw new Error('lifecycle-test: activate deliberately throws'); });
`

const variants = [
  { file: 'lifecycle-throws.scext', id: 'com.smartchat.lifecycle-test-throws', version: '1.0.0', perms: ['ui:toast'], index: throwingIndex },
  { file: 'lifecycle-v1.scext', id: 'com.smartchat.lifecycle-test', version: '1.0.0', perms: ['storage:read', 'storage:write', 'ui:toast'], index: workingIndex('1.0.0') },
  { file: 'lifecycle-v2.scext', id: 'com.smartchat.lifecycle-test', version: '2.0.0', perms: ['storage:read', 'storage:write', 'ui:toast', 'ui:notification'], index: workingIndex('2.0.0') }
]

;(async () => {
  for (const v of variants) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lifecycle-'))
    fs.writeFileSync(path.join(dir, 'manifest.json'), JSON.stringify({
      id: v.id, name: 'Lifecycle Test ' + v.version, version: v.version, apiVersion: '2', main: 'index.js',
      description: 'Smoke item 21 helper', permissions: v.perms, contributions: {}
    }, null, 2))
    fs.writeFileSync(path.join(dir, 'index.js'), v.index)
    const out = await packagePlugin({ pluginDir: dir, outPath: path.join(outDir, v.file) })
    console.log('built', out)
    fs.rmSync(dir, { recursive: true, force: true })
  }
})().catch((e) => { console.error(e); process.exit(1) })
