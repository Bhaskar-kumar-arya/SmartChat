/**
 * Parse a timestamp-ish value into a BigInt, tolerating malformed input.
 *
 * `BigInt()` throws synchronously on any non-numeric string
 * (`BigInt('2026-01-01')`, `BigInt('abc')`). A single bad `lastMessageTimestamp`
 * from the backend must not take down a whole `useMemo` / realtime event handler —
 * there is no error boundary around the chat list (F3-10).
 */
export const toBigIntTime = (value: string | number | null | undefined): bigint => {
  if (value == null || value === '') return 0n
  try {
    if (typeof value === 'number') {
      return Number.isFinite(value) ? BigInt(Math.trunc(value)) : 0n
    }
    const s = String(value).trim()
    if (!/^-?\d+$/.test(s)) return 0n
    return BigInt(s)
  } catch {
    return 0n
  }
}
