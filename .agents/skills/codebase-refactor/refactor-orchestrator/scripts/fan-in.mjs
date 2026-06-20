#!/usr/bin/env node
/**
 * Fan-in analysis script — cross-platform replacement for the madge + node -e pipeline.
 *
 * Usage:
 *   node scripts/fan-in.mjs [--top N] [--tsconfig path] [--src path]
 *
 * Defaults:
 *   --top 25         Show top N files by fan-in count
 *   --tsconfig tsconfig.json
 *   --src src/
 *
 * Requires: madge (npx madge)
 */

import { execSync } from 'child_process';
import { resolve } from 'path';

const args = process.argv.slice(2);
function getArg(name, defaultVal) {
  const idx = args.indexOf(`--${name}`);
  return idx !== -1 && args[idx + 1] ? args[idx + 1] : defaultVal;
}

const top = parseInt(getArg('top', '25'), 10);
const tsconfig = getArg('tsconfig', 'tsconfig.json');
const srcDir = getArg('src', 'src/');

try {
  const rawJson = execSync(
    `npx madge --json --ts-config ${tsconfig} --extensions ts ${srcDir}`,
    { encoding: 'utf8', maxBuffer: 10 * 1024 * 1024 }
  );

  const data = JSON.parse(rawJson);
  const fanIn = {};

  for (const [, deps] of Object.entries(data)) {
    for (const dep of deps) {
      fanIn[dep] = (fanIn[dep] || 0) + 1;
    }
  }

  const sorted = Object.entries(fanIn)
    .sort((a, b) => b[1] - a[1])
    .slice(0, top);

  for (const [file, count] of sorted) {
    console.log(`${count}\t${file}`);
  }
} catch (err) {
  console.error('Fan-in analysis failed:', err.message);
  process.exit(1);
}
