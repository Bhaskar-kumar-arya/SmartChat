/**
 * Normalize an epoch value to milliseconds. Most back-end timestamps are in
 * seconds, but a few fields (edit timestamps, some receipt payloads) are
 * already milliseconds. Values past ~2001-09 expressed in ms (> 1e12) are
 * treated as ms; everything smaller is treated as seconds (F11-07).
 */
export const epochToMs = (num: number): number => (Math.abs(num) > 1e12 ? num : num * 1000)

export const formatTime = (ts: string) => {
  try {
    const num = Number(ts)
    if (isNaN(num)) return ''
    const date = new Date(epochToMs(num))
    if (isNaN(date.getTime())) return ''
    return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
  } catch {
    return ''
  }
}

export const formatDate = (ts: string) => {
  try {
    const num = Number(ts)
    if (isNaN(num)) return ''
    const date = new Date(epochToMs(num))
    if (isNaN(date.getTime())) return ''
    const now = new Date()
    if (date.toDateString() === now.toDateString()) return 'Today'
    const yesterday = new Date(now)
    yesterday.setDate(yesterday.getDate() - 1)
    if (date.toDateString() === yesterday.toDateString()) return 'Yesterday'
    const opts: Intl.DateTimeFormatOptions = { weekday: 'long', month: 'long', day: 'numeric' }
    if (date.getFullYear() !== now.getFullYear()) opts.year = 'numeric'
    return date.toLocaleDateString([], opts)
  } catch {
    return ''
  }
}

export const formatChatTime = (ts: string) => {
  try {
    const num = Number(ts)
    if (isNaN(num)) return ''
    const date = new Date(epochToMs(num))
    if (isNaN(date.getTime())) return ''
    const now = new Date()
    const isToday = date.toDateString() === now.toDateString()
    if (isToday) {
      return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    }
    const yesterday = new Date(now)
    yesterday.setDate(yesterday.getDate() - 1)
    if (date.toDateString() === yesterday.toDateString()) {
      return 'Yesterday'
    }
    return date.toLocaleDateString([], { month: 'short', day: 'numeric' })
  } catch {
    return ''
  }
}

export const isMuted = (expiration?: string) => {
  if (!expiration) return false
  const expTime = Number(expiration) * 1000
  return expTime === -1000 || expTime > Date.now()
}

export const formatReceiptTime = (timestampStr: string): string => {
  try {
    const ts = parseInt(timestampStr, 10)
    if (isNaN(ts)) return ''
    return new Date(epochToMs(ts)).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
  } catch {
    return ''
  }
}

export const formatReceiptDate = (timestampStr: string): string => {
  try {
    const ts = parseInt(timestampStr, 10)
    if (isNaN(ts)) return ''
    return new Date(epochToMs(ts)).toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' })
  } catch {
    return ''
  }
}

export const formatSenderName = (
  fromMe: boolean,
  participantName?: string | null,
  participant?: string | null,
  fallback: string | null = null
): string | null => {
  if (fromMe) return 'You'
  return participantName || participant?.split('@')[0] || fallback
}
