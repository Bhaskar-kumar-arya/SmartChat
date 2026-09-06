/**
 * Escapes the five XML-significant characters so untrusted WhatsApp metadata
 * (group names, push names, jids) interpolated into the `<mentioned_chat>`
 * blocks cannot break out of the structured block and inject instructions into
 * the LLM context (prompt injection via chat metadata — see audit S6-06).
 */
export function escapeXml(value: unknown): string {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
}
