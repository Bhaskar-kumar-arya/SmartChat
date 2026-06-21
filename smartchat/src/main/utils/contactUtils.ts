export function getDisplayName(
  identity: {
    displayName?: string | null
    verifiedName?: string | null
    pushName?: string | null
    phoneNumber?: string | null
  } | null | undefined,
  fallback: string = 'Unknown'
): string {
  if (!identity) return fallback
  if (identity.displayName) return identity.displayName
  if (identity.verifiedName) return identity.verifiedName
  if (identity.pushName) {
    const trimmed = identity.pushName.trim()
    if (trimmed) {
      return trimmed.startsWith('~') ? trimmed : `~ ${trimmed}`
    }
  }
  return identity.phoneNumber?.split('@')[0] || fallback
}
