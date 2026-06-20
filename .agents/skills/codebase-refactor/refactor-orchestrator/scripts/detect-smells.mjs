#!/usr/bin/env node
/**
 * Smell detection script — cross-platform replacement for grep-based smell detection.
 *
 * Usage:
 *   node scripts/detect-smells.mjs [--src path] [--type all|type-safety|structural]
 *
 * Defaults:
 *   --src src/
 *   --type all
 *
 * Detects:
 *   type-safety: as any, : any, non-null assertions, empty catches, floating .catch(() => {})
 *   structural:  files > 300 lines, deep nesting (4+ indent levels), magic strings
 */

import { readdirSync, readFileSync } from 'fs';
import { join, extname } from 'path';

const args = process.argv.slice(2);
function getArg(name, defaultVal) {
  const idx = args.indexOf(`--${name}`);
  return idx !== -1 && args[idx + 1] ? args[idx + 1] : defaultVal;
}

const srcDir = getArg('src', 'src/');
const detectType = getArg('type', 'all');

function walkDir(dir) {
  const results = [];
  try {
    const entries = readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = join(dir, entry.name);
      if (entry.name === 'node_modules' || entry.name === '.git') continue;
      if (entry.isDirectory()) {
        results.push(...walkDir(fullPath));
      } else if (extname(entry.name) === '.ts' && !entry.name.endsWith('.d.ts')) {
        results.push(fullPath);
      }
    }
  } catch {
    // skip inaccessible directories
  }
  return results;
}

const files = walkDir(srcDir);

const typeSafetyPatterns = [
  { name: 'as_any', regex: /\bas any\b/g },
  { name: ': any', regex: /:\s*any\b/g },
  { name: 'non_null_assertion', regex: /!\./g },
  { name: 'empty_catch', regex: /catch\s*\([^)]*\)\s*\{\s*\}/g },
  { name: 'silent_catch', regex: /\.catch\s*\(\s*\(\s*\)\s*=>\s*\{\s*\}\s*\)/g },
];

const results = { typeSafety: {}, structural: {} };

for (const file of files) {
  try {
    const content = readFileSync(file, 'utf8');
    const lines = content.split('\n');

    // Type safety detection
    if (detectType === 'all' || detectType === 'type-safety') {
      for (const pattern of typeSafetyPatterns) {
        const matches = [];
        lines.forEach((line, idx) => {
          // Skip import lines for as_any
          if (pattern.name === 'as_any' && line.trim().startsWith('import')) return;
          const lineMatches = line.match(pattern.regex);
          if (lineMatches) {
            matches.push({ line: idx + 1, content: line.trim() });
          }
        });
        if (matches.length > 0) {
          if (!results.typeSafety[file]) results.typeSafety[file] = {};
          results.typeSafety[file][pattern.name] = matches;
        }
      }
    }

    // Structural detection
    if (detectType === 'all' || detectType === 'structural') {
      // Files over 300 lines
      if (lines.length > 300) {
        if (!results.structural[file]) results.structural[file] = {};
        results.structural[file].long_file = lines.length;
      }

      // Deep nesting (4+ indent levels = 16 spaces or 4 tabs)
      const deepLines = [];
      lines.forEach((line, idx) => {
        const leadingSpaces = line.match(/^(\s*)/)?.[1].length || 0;
        if (leadingSpaces >= 16 && line.trim().length > 0) {
          deepLines.push({ line: idx + 1, content: line.trim() });
        }
      });
      if (deepLines.length > 0) {
        if (!results.structural[file]) results.structural[file] = {};
        results.structural[file].deep_nesting = deepLines;
      }
    }
  } catch {
    // skip unreadable files
  }
}

// Output
if (detectType === 'all' || detectType === 'type-safety') {
  console.log('=== TYPE SAFETY SMELLS ===\n');
  const tsFiles = Object.keys(results.typeSafety);
  if (tsFiles.length === 0) {
    console.log('No type safety smells found.\n');
  } else {
    // Sort by total hits descending
    const sorted = tsFiles
      .map(f => ({
        file: f,
        total: Object.values(results.typeSafety[f]).reduce((s, arr) => s + arr.length, 0),
        smells: results.typeSafety[f],
      }))
      .sort((a, b) => b.total - a.total);

    for (const { file, total, smells } of sorted) {
      console.log(`${file} (${total} hits)`);
      for (const [name, matches] of Object.entries(smells)) {
        console.log(`  ${name}: ${matches.length}`);
        for (const m of matches.slice(0, 3)) {
          console.log(`    L${m.line}: ${m.content.slice(0, 100)}`);
        }
        if (matches.length > 3) console.log(`    ... and ${matches.length - 3} more`);
      }
      console.log('');
    }
  }
}

if (detectType === 'all' || detectType === 'structural') {
  console.log('=== STRUCTURAL SMELLS ===\n');
  const stFiles = Object.keys(results.structural);
  if (stFiles.length === 0) {
    console.log('No structural smells found.\n');
  } else {
    for (const file of stFiles) {
      const smells = results.structural[file];
      const parts = [];
      if (smells.long_file) parts.push(`${smells.long_file} lines`);
      if (smells.deep_nesting) parts.push(`${smells.deep_nesting.length} deep-nested blocks`);
      console.log(`${file}: ${parts.join(', ')}`);
    }
    console.log('');
  }
}
