#!/usr/bin/env node
/**
 * Line count analysis — cross-platform replacement for find | xargs wc -l | awk.
 *
 * Usage:
 *   node scripts/line-count.mjs [--min N] [--src path] [--ext .ts]
 *
 * Defaults:
 *   --min 300        Only show files with more than N lines
 *   --src src/
 *   --ext .ts
 *
 * Shows files sorted by line count (highest first).
 */

import { readdirSync, statSync, readFileSync } from 'fs';
import { join, extname } from 'path';

const args = process.argv.slice(2);
function getArg(name, defaultVal) {
  const idx = args.indexOf(`--${name}`);
  return idx !== -1 && args[idx + 1] ? args[idx + 1] : defaultVal;
}

const minLines = parseInt(getArg('min', '300'), 10);
const srcDir = getArg('src', 'src/');
const ext = getArg('ext', '.ts');

function walkDir(dir) {
  const results = [];
  try {
    const entries = readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = join(dir, entry.name);
      if (entry.name === 'node_modules' || entry.name === '.git') continue;
      if (entry.isDirectory()) {
        results.push(...walkDir(fullPath));
      } else if (extname(entry.name) === ext) {
        results.push(fullPath);
      }
    }
  } catch {
    // skip inaccessible directories
  }
  return results;
}

const files = walkDir(srcDir);
const counts = [];

for (const file of files) {
  try {
    const content = readFileSync(file, 'utf8');
    const lineCount = content.split('\n').length;
    if (lineCount > minLines) {
      counts.push({ file, lineCount });
    }
  } catch {
    // skip unreadable files
  }
}

counts.sort((a, b) => b.lineCount - a.lineCount);

if (counts.length === 0) {
  console.log(`No files with more than ${minLines} lines found.`);
} else {
  for (const { file, lineCount } of counts) {
    console.log(`${lineCount}\t${file}`);
  }
}
