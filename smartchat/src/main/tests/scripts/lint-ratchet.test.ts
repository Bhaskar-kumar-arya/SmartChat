import { describe, it, expect } from 'vitest'
import * as core from '../../../../scripts/lint-ratchet-core.mjs'

const base = {
  zeroTolerance: ['react-hooks/rules-of-hooks'],
  rules: { a: 5, b: 2, 'react-hooks/rules-of-hooks': 1 }
}

describe('lint ratchet core', () => {
  it('counts per rule, excluding prettier', () => {
    const res = [
      { messages: [{ ruleId: 'a' }, { ruleId: 'prettier/prettier' }, { ruleId: null }] },
      { messages: [{ ruleId: 'a' }] }
    ]
    expect(core.countByRule(res)).toEqual({ '(no-rule)': 1, a: 2 })
  })
  it('passes when equal or lower, reports improvements', () => {
    const r = core.compare(base, { a: 4, b: 2, 'react-hooks/rules-of-hooks': 1 })
    expect(r.ok).toBe(true)
    expect(r.improvements).toHaveLength(1)
  })
  it('fails on a rise or a new rule', () => {
    const r = core.compare(base, { a: 6, b: 2, c: 1, 'react-hooks/rules-of-hooks': 1 })
    expect(r.ok).toBe(false)
    expect(r.regressions.map((x: { rule: string }) => x.rule)).toEqual(['a', 'c'])
  })
  it('treats a zero-tolerance rule missing from rules as 0', () => {
    expect(core.compare({ zeroTolerance: ['z'], rules: {} }, { z: 1 }).ok).toBe(false)
  })
  it('update only lowers unless forced; keeps zero-tolerance at 0', () => {
    expect(() => core.buildUpdatedBaseline(base, { a: 9 })).toThrow()
    const lowered = core.buildUpdatedBaseline(base, { a: 3 })
    expect(lowered.rules).toEqual({ a: 3, 'react-hooks/rules-of-hooks': 0 })
    expect(core.buildUpdatedBaseline(base, { a: 9 }, { force: true }).rules.a).toBe(9)
  })
})
