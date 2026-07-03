/**
 * Compares two WhatsApp JIDs (LID or phone number formats) by comparing
 * their phone number/identifier parts.
 * Example: "12345@s.whatsapp.net" is matching "12345@lid"
 */
export const isSameJid = (jid1: string | null | undefined, jid2: string | null | undefined): boolean => {
  if (!jid1 || !jid2) return false
  const u1 = jid1.split('@')[0].split(':')[0]
  const u2 = jid2.split('@')[0].split(':')[0]
  return u1 === u2
}
