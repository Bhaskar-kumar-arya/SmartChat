import { describe, it, expect } from 'vitest'
import {
  toLocalDayStartISO,
  toLocalDayEndISO,
  formatLocalDate,
  isoToLocalDateInput
} from '@renderer/utils/dateRange'

describe('dateRange helpers (F7-02 / F7-03)', () => {
  it('toLocalDayStartISO is local midnight of the given day', () => {
    const iso = toLocalDayStartISO('2026-01-15')!
    const d = new Date(iso)
    expect(d.getFullYear()).toBe(2026)
    expect(d.getMonth()).toBe(0)
    expect(d.getDate()).toBe(15)
    expect(d.getHours()).toBe(0)
    expect(d.getMinutes()).toBe(0)
    expect(d.getSeconds()).toBe(0)
    expect(d.getMilliseconds()).toBe(0)
  })

  it('toLocalDayEndISO is inclusive end-of-day (23:59:59.999 local)', () => {
    const iso = toLocalDayEndISO('2026-01-15')!
    const d = new Date(iso)
    expect(d.getDate()).toBe(15)
    expect(d.getHours()).toBe(23)
    expect(d.getMinutes()).toBe(59)
    expect(d.getSeconds()).toBe(59)
    expect(d.getMilliseconds()).toBe(999)
  })

  it('end bound covers a same-day range (15th to 15th is not empty)', () => {
    const from = new Date(toLocalDayStartISO('2026-01-15')!).getTime()
    const to = new Date(toLocalDayEndISO('2026-01-15')!).getTime()
    expect(to - from).toBeGreaterThan(23 * 3600 * 1000)
  })

  it('formatLocalDate uses local getters', () => {
    const d = new Date(2026, 2, 4, 12, 0, 0)
    expect(formatLocalDate(d)).toBe('2026-03-04')
  })

  it('formatLocalDate / isoToLocalDateInput round-trip a local-day ISO', () => {
    const iso = toLocalDayStartISO('2026-12-31')!
    expect(isoToLocalDateInput(iso)).toBe('2026-12-31')
  })

  it('returns undefined / empty for malformed input', () => {
    expect(toLocalDayStartISO('nonsense')).toBeUndefined()
    expect(toLocalDayEndISO('')).toBeUndefined()
    expect(isoToLocalDateInput(undefined)).toBe('')
  })
})
