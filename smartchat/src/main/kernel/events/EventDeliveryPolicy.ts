import { IPermissionStore } from '../permissions/IPermissionStore'

/**
 * Events that carry message/chat content for *many* chats in a single payload
 * (the jid lives under `messages[].key.remoteJid`, not at the top level). For a
 * chat-scoped subscription these must be filtered element-by-element or the
 * plugin receives the full cross-chat backlog. (S7-01)
 */
const MULTI_CHAT_ARRAY_EVENTS = new Set<string>(['messages:append'])

export type EventDecision = { deliver: false } | { deliver: true; payload: unknown }

/**
 * The single policy that decides whether (and in what shape) a WhatsApp bus
 * event reaches a plugin, shared by the worker-plugin events module and the
 * panel IPC path so they cannot drift apart. (B-KRN-06, B-KRN-10)
 *
 *  - subscribe gate:  `resolveAuthKey`
 *  - delivery gate:   `decide` re-checks the authorising capability (so revoking
 *    it in Settings stops a live subscription), applies the per-chat resource
 *    scope, and sanitises the payload.
 *
 * With no permission store wired (tests / legacy) nothing is gated.
 */
export class EventDeliveryPolicy {
  constructor(private readonly permissions?: IPermissionStore) {}

  /**
   * Subscribe-time gate. Returns the capability key that authorises the
   * subscription (`events:<name>` preferred, else `events:*`), or `null` if the
   * plugin holds neither. The delivery-time checks are made against this key only.
   */
  resolveAuthKey(pluginId: string, eventName: string): string | null {
    const perm = `events:${eventName}`
    if (!this.permissions) return perm
    if (this.permissions.hasCapability(pluginId, perm)) return perm
    if (this.permissions.hasCapability(pluginId, 'events:*')) return 'events:*'
    return null
  }

  /** Delivery-time decision for one bus event. */
  decide(pluginId: string, eventName: string, authKey: string, data: unknown): EventDecision {
    const permissions = this.permissions
    // Capability may have been revoked since subscribe time. (B-KRN-10)
    if (permissions && !permissions.hasCapability(pluginId, authKey)) return { deliver: false }

    const allowed = (jid: string): boolean =>
      permissions ? permissions.isResourceAllowed(pluginId, authKey, jid) : true

    let payload: unknown = data
    if (MULTI_CHAT_ARRAY_EVENTS.has(eventName)) {
      // `isResourceAllowed` is default-allow, so an unscoped plugin keeps the whole payload. (S7-01)
      const filtered = filterMultiChatArrayPayload(eventName, data, allowed)
      if (!filtered) return { deliver: false }
      payload = filtered
    } else {
      // Best-effort per-chat scope filter, against the authorising key only. (S7-01, S7-02)
      const chatJid = extractChatJid(data)
      if (chatJid && !allowed(chatJid)) return { deliver: false }
    }
    return { deliver: true, payload: sanitizeForPlugin(payload) }
  }
}

/**
 * Filter a multi-chat array event payload down to the array elements whose
 * owning chat the plugin is allowed to see. Returns the narrowed payload, or
 * `undefined` if nothing remains (the event should not be delivered). (S7-01)
 */
function filterMultiChatArrayPayload(
  eventName: string,
  data: unknown,
  allowed: (jid: string) => boolean
): unknown | undefined {
  if (!data || typeof data !== 'object') return data
  if (eventName === 'messages:append') {
    const o = data as { messages?: unknown[] }
    if (!Array.isArray(o.messages)) return data
    const kept = o.messages.filter((m) => {
      const jid = (m as { key?: { remoteJid?: unknown } })?.key?.remoteJid
      return typeof jid === 'string' ? allowed(jid) : true
    })
    if (kept.length === 0) return undefined
    return { ...o, messages: kept }
  }
  return data
}

/** Extract a single owning chat jid from a WA event payload, if it has one. */
function extractChatJid(val: unknown): string | undefined {
  if (!val || typeof val !== 'object') return undefined
  const o = val as { chatJid?: unknown; remoteJid?: unknown; jid?: unknown; key?: { remoteJid?: unknown } }
  const direct = o.chatJid ?? o.remoteJid ?? o.jid
  if (typeof direct === 'string' && direct.includes('@')) return direct
  const keyJid = o.key?.remoteJid
  if (typeof keyJid === 'string' && keyJid.includes('@')) return keyJid
  return undefined
}

export function sanitizeForPlugin(val: unknown): unknown {
  if (val === null || val === undefined) return val
  const type = typeof val
  if (type === 'function' || type === 'symbol') {
    return undefined
  }
  if (type === 'bigint') {
    return (val as bigint).toString()
  }
  if (type === 'object') {
    if (Array.isArray(val)) {
      return val.map((item) => sanitizeForPlugin(item)).filter((v) => v !== undefined)
    }
    const clean: Record<string, unknown> = {}
    for (const key of Object.keys(val as object)) {
      if (key === 'sock') continue
      const cleanedVal = sanitizeForPlugin((val as Record<string, unknown>)[key])
      if (cleanedVal !== undefined) {
        clean[key] = cleanedVal
      }
    }
    return clean
  }
  return val
}
