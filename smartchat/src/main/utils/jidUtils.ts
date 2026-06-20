/**
 * Cleans a WhatsApp JID by stripping any device/agent/port suffix (e.g. :1, :2, .0:1).
 * Example: "919606910020:2@s.whatsapp.net" -> "919606910020@s.whatsapp.net"
 *          "12345:1@lid" -> "12345@lid"
 *          "12036329439228@g.us" -> "12036329439228@g.us"
 */
export function cleanJid(jid: string | null | undefined): string {
  if (!jid) return ''
  const parts = jid.split('@')
  if (parts.length < 2) return jid
  const base = parts[0].split(':')[0]
  const suffix = parts[1]
  return `${base}@${suffix}`
}
