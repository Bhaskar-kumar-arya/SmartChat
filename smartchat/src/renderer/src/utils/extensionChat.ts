/**
 * Extension dedicated-chat identifiers.
 *
 * Chat-list rows for extensions use the jid form `extension_<id>`; navigation
 * intents / `onOpenChat` payloads use `extension:<id>`. Keep both prefixes here
 * so no call site hard-codes them.
 */
export const EXTENSION_CHAT_JID_PREFIX = 'extension_'
export const EXTENSION_NAV_PREFIX = 'extension:'

export const toExtensionChatJid = (extensionId: string): string =>
  `${EXTENSION_CHAT_JID_PREFIX}${extensionId}`

/** The extension id for either prefix form, or null for an ordinary chat jid. */
export function parseExtensionChatId(jid: string): string | null {
  if (jid.startsWith(EXTENSION_NAV_PREFIX)) return jid.slice(EXTENSION_NAV_PREFIX.length)
  if (jid.startsWith(EXTENSION_CHAT_JID_PREFIX)) return jid.slice(EXTENSION_CHAT_JID_PREFIX.length)
  return null
}
