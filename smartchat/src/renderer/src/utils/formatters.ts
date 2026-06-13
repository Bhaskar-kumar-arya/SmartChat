export const formatTime = (ts: string) => {
  try {
    const date = new Date(Number(ts) * 1000)
    return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
  } catch {
    return ''
  }
}

export const formatDate = (ts: string) => {
  try {
    const date = new Date(Number(ts) * 1000)
    const now = new Date()
    if (date.toDateString() === now.toDateString()) return 'Today'
    const yesterday = new Date(now)
    yesterday.setDate(yesterday.getDate() - 1)
    if (date.toDateString() === yesterday.toDateString()) return 'Yesterday'
    return date.toLocaleDateString([], { weekday: 'long', month: 'long', day: 'numeric' })
  } catch {
    return ''
  }
}

export const formatChatTime = (ts: string) => {
  try {
    const date = new Date(Number(ts) * 1000)
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
    return new Date(ts * 1000).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
  } catch {
    return ''
  }
}

export const formatReceiptDate = (timestampStr: string): string => {
  try {
    const ts = parseInt(timestampStr, 10)
    if (isNaN(ts)) return ''
    return new Date(ts * 1000).toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' })
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
