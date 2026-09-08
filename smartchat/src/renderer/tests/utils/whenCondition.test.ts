import { describe, it, expect } from 'vitest'
import { evaluateWhen } from '@renderer/utils/whenCondition'

describe('evaluateWhen', () => {
  it('returns true when condition is undefined', () => {
    expect(evaluateWhen(undefined, {} as never)).toBe(true)
  })

  it('eq / neq against a present field', () => {
    const ctx = { 'chat.isPinned': true } as unknown as never
    expect(evaluateWhen({ field: 'chat.isPinned', op: 'eq', value: true }, ctx)).toBe(true)
    expect(evaluateWhen({ field: 'chat.isPinned', op: 'neq', value: false }, ctx)).toBe(true)
    expect(evaluateWhen({ field: 'chat.isPinned', op: 'neq', value: true }, ctx)).toBe(false)
  })

  // F2-07
  it('neq does NOT pass when the field is absent from the context', () => {
    expect(evaluateWhen({ field: 'x', op: 'neq', value: 'foo' }, {} as never)).toBe(false)
  })

  it('nin does NOT pass when the field is absent from the context', () => {
    expect(evaluateWhen({ field: 'x', op: 'nin', value: ['a', 'b'] }, {} as never)).toBe(false)
  })

  it('nin passes when a present field is not in the list', () => {
    const ctx = { x: 'c' } as unknown as never
    expect(evaluateWhen({ field: 'x', op: 'nin', value: ['a', 'b'] }, ctx)).toBe(true)
  })

  it('all / any / not combinators', () => {
    const ctx = { a: 1, b: 2 } as unknown as never
    expect(
      evaluateWhen({ all: [{ field: 'a', op: 'eq', value: 1 }, { field: 'b', op: 'eq', value: 2 }] }, ctx)
    ).toBe(true)
    expect(
      evaluateWhen({ any: [{ field: 'a', op: 'eq', value: 99 }, { field: 'b', op: 'eq', value: 2 }] }, ctx)
    ).toBe(true)
    expect(evaluateWhen({ not: { field: 'a', op: 'eq', value: 1 } }, ctx)).toBe(false)
  })
})
