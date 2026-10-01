// Pure logic for the lint ratchet (G-03). No I/O so it can be unit-tested.

export const EXCLUDED_RULES = ['prettier/prettier']
export const NO_RULE_KEY = '(no-rule)'

export function sortKeys(obj) {
  const out = {}
  for (const k of Object.keys(obj).sort()) out[k] = obj[k]
  return out
}

/** Count errors+warnings per rule from ESLint JSON results. Keys sorted. */
export function countByRule(results, excluded = EXCLUDED_RULES) {
  const counts = {}
  for (const file of results) {
    for (const m of file.messages) {
      const key = m.ruleId || NO_RULE_KEY
      if (excluded.includes(key)) continue
      counts[key] = (counts[key] || 0) + 1
    }
  }
  return sortKeys(counts)
}

/**
 * Compare current counts against a baseline ({ zeroTolerance, rules }).
 * regressions: count rose, or rule not in baseline (treated as 0).
 * improvements: count fell (including to zero).
 * zeroTolerance rules missing from `rules` count as 0, so flipping a rule to
 * zero-tolerance is just setting its baseline count to 0.
 */
export function compare(baseline, current) {
  const base = baseline.rules || {}
  const zero = new Set(baseline.zeroTolerance || [])
  const regressions = []
  const improvements = []
  const names = new Set([...Object.keys(base), ...Object.keys(current), ...zero])
  for (const rule of [...names].sort()) {
    const was = base[rule] ?? 0
    const now = current[rule] ?? 0
    const isNew = !(rule in base)
    if (now > was) {
      regressions.push({ rule, was, now, isNew, zeroTolerance: zero.has(rule) })
    } else if (now < was) {
      improvements.push({ rule, was, now, zeroTolerance: zero.has(rule) })
    }
  }
  return { regressions, improvements, ok: regressions.length === 0 }
}

/**
 * Build the baseline to write for --update. Without force, only lowering is
 * allowed: throws if any regression exists. Rules at 0 are dropped unless
 * listed in zeroTolerance (they stay, pinned at 0).
 */
export function buildUpdatedBaseline(baseline, current, { force = false } = {}) {
  const { regressions } = compare(baseline, current)
  if (regressions.length && !force) {
    throw new Error(
      'Refusing to raise baseline counts without --force: ' +
        regressions.map((r) => r.rule).join(', ')
    )
  }
  const zeroTolerance = [...(baseline.zeroTolerance || [])].sort()
  const rules = {}
  for (const [rule, n] of Object.entries(current)) if (n > 0) rules[rule] = n
  for (const rule of zeroTolerance) if (!(rule in rules)) rules[rule] = 0
  return { version: 1, zeroTolerance, rules: sortKeys(rules) }
}

export function formatReport({ regressions, improvements }) {
  const lines = []
  if (regressions.length) {
    lines.push('Lint ratchet FAILED: counts rose above baseline.')
    for (const r of regressions) {
      lines.push(
        `  ${r.rule}: ${r.was} -> ${r.now} (+${r.now - r.was})${r.isNew ? ' [new rule]' : ''}${r.zeroTolerance ? ' [zero-tolerance]' : ''}`
      )
    }
    lines.push('Fix the new violations; do not raise the baseline.')
  }
  if (improvements.length) {
    if (!regressions.length) lines.push('Lint ratchet passed.')
    lines.push('Counts fell below baseline; lock it in with `npm run lint:ratchet -- --update`:')
    for (const i of improvements) lines.push(`  ${i.rule}: ${i.was} -> ${i.now}`)
  }
  return lines.join('\n')
}
