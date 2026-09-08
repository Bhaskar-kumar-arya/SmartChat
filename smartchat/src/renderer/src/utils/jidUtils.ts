/**
 * Compares two WhatsApp JIDs (LID or phone number formats) by comparing
 * their phone number/identifier parts.
 * Example: "12345@s.whatsapp.net" is matching "12345@lid"
 *
 * The identifier alone is not enough: the same numeric string in different
 * domain namespaces (`@g.us`, `@newsletter`, `@broadcast`, `status@broadcast`,
 * ...) refers to unrelated things, so a domain-kind mismatch there returns
 * `false` (F11-03). `@lid` <-> `@s.whatsapp.net`/`@c.us` is the one cross-format
 * pair the app deliberately treats as the same identity — the presence layer
 * (usePresence / F3-07) and reaction ownership (MessageItem / F5-05) rely on it.
 */
const PERSON_DOMAINS = new Set(['lid', 's.whatsapp.net', 'c.us', ''])

export const isSameJid = (jid1: string | null | undefined, jid2: string | null | undefined): boolean => {
  if (!jid1 || !jid2) return false
  const [ident1, domain1 = ''] = jid1.split('@')
  const [ident2, domain2 = ''] = jid2.split('@')
  const u1 = ident1.split(':')[0]
  const u2 = ident2.split(':')[0]
  if (!u1 || u1 !== u2) return false
  if (domain1 !== domain2 && !(PERSON_DOMAINS.has(domain1) && PERSON_DOMAINS.has(domain2))) {
    return false
  }
  return true
}
