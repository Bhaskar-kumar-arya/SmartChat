// Lint ratchet (G-03). Runs ESLint, counts errors+warnings per rule (excluding
// prettier/prettier) and compares with scripts/lint-baseline.json.
//   node scripts/lint-ratchet.mjs                   check (exit 1 on regression)
//   node scripts/lint-ratchet.mjs --update          lower the baseline (no raising)
//   node scripts/lint-ratchet.mjs --update --force  allow raising / new rules
import { spawnSync } from 'node:child_process'
import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { buildUpdatedBaseline, compare, countByRule, formatReport } from './lint-ratchet-core.mjs'

const here = dirname(fileURLToPath(import.meta.url))
const root = join(here, '..')
const baselinePath = join(here, 'lint-baseline.json')
const args = new Set(process.argv.slice(2))

const require = createRequire(import.meta.url)
const eslintPkg = require.resolve('eslint/package.json', { paths: [root] })
const eslintBin = join(dirname(eslintPkg), 'bin', 'eslint.js')
const run = spawnSync(process.execPath, [eslintBin, '.', '--format', 'json', '--no-cache'], {
  cwd: root,
  encoding: 'utf8',
  maxBuffer: 512 * 1024 * 1024
})
let results
try {
  results = JSON.parse(run.stdout)
} catch {
  console.error(
    'Could not parse ESLint JSON output.\n' + (run.stderr || run.stdout || '').slice(0, 2000)
  )
  process.exit(2)
}
const current = countByRule(results)

const baseline = existsSync(baselinePath)
  ? JSON.parse(readFileSync(baselinePath, 'utf8'))
  : { version: 1, zeroTolerance: [], rules: {} }

if (args.has('--update')) {
  try {
    const next = buildUpdatedBaseline(baseline, current, { force: args.has('--force') })
    writeFileSync(baselinePath, JSON.stringify(next, null, 2) + '\n')
    console.log(`Baseline written (${Object.keys(next.rules).length} rules).`)
    process.exit(0)
  } catch (e) {
    console.error(e.message)
    console.error(formatReport(compare(baseline, current)))
    process.exit(1)
  }
}

const cmp = compare(baseline, current)
const report = formatReport(cmp)
if (report) console[cmp.ok ? 'log' : 'error'](report)
else console.log('Lint ratchet passed (no change).')
process.exit(cmp.ok ? 0 : 1)
