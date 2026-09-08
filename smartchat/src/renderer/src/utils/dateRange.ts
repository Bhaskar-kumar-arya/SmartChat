/**
 * Date-range helpers for the search UI.
 *
 * `<input type="date">` values are `YYYY-MM-DD` with no timezone. Passing them
 * straight to `new Date(str)` parses them as **UTC midnight**, which shifts the
 * effective range by up to a day for users east/west of UTC and makes the
 * `toDate` bound exclude almost the entire selected end day (F7-02 / F7-03).
 *
 * These helpers build the bounds from LOCAL time instead.
 */

function parts(dateStr: string): [number, number, number] | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateStr.trim())
  if (!m) return null
  const y = Number(m[1])
  const mo = Number(m[2])
  const d = Number(m[3])
  if (!y || !mo || !d) return null
  return [y, mo, d]
}

/** `YYYY-MM-DD` → ISO string for local start-of-day (00:00:00.000). */
export function toLocalDayStartISO(dateStr: string): string | undefined {
  const p = parts(dateStr)
  if (!p) return undefined
  return new Date(p[0], p[1] - 1, p[2], 0, 0, 0, 0).toISOString()
}

/** `YYYY-MM-DD` → ISO string for local end-of-day (23:59:59.999), inclusive. */
export function toLocalDayEndISO(dateStr: string): string | undefined {
  const p = parts(dateStr)
  if (!p) return undefined
  return new Date(p[0], p[1] - 1, p[2], 23, 59, 59, 999).toISOString()
}

/** A `Date` → `YYYY-MM-DD` using local getters (not `toISOString`). */
export function formatLocalDate(date: Date): string {
  if (Number.isNaN(date.getTime())) return ''
  const y = date.getFullYear()
  const mo = String(date.getMonth() + 1).padStart(2, '0')
  const d = String(date.getDate()).padStart(2, '0')
  return `${y}-${mo}-${d}`
}

/** An ISO string (or empty) → `YYYY-MM-DD` for a `<input type="date">` value. */
export function isoToLocalDateInput(iso?: string): string {
  if (!iso) return ''
  return formatLocalDate(new Date(iso))
}
