/**
 * App navigation bus (F12-02).
 *
 * Cross-component navigation ("open chat" / "jump to message" from AI citations,
 * search, notifications, …) used to be a fire-and-forget
 * `window.dispatchEvent(new CustomEvent('smartchat:open-chat'))` whose only
 * listener lived inside `ChatLayout` — so an intent dispatched while `ChatLayout`
 * was unmounted (QR / sync / `connected` screens) or during the listener's
 * teardown/re-add gap on a chat switch was silently lost.
 *
 * This module:
 *  - retains the last intent when there is no live listener and replays it the
 *    moment one subscribes;
 *  - de-dupes identical back-to-back intents fired within a short window
 *    (double-clicked citation);
 *  - still emits the legacy `smartchat:open-chat` window event so any external
 *    listener / existing test keeps working.
 */

export interface NavigationIntent {
  jid: string
  targetMessageId?: string
}

type Listener = (intent: NavigationIntent) => void

const DEDUPE_WINDOW_MS = 400

let listeners: Listener[] = []
let pending: NavigationIntent | null = null
let lastKey = ''
let lastAt = 0

function keyOf(intent: NavigationIntent): string {
  return `${intent.jid}::${intent.targetMessageId ?? ''}`
}

export function navigate(intent: NavigationIntent): void {
  const key = keyOf(intent)
  const now = Date.now()
  if (key === lastKey && now - lastAt < DEDUPE_WINDOW_MS) return
  lastKey = key
  lastAt = now

  // Legacy compatibility — external listeners / tests.
  window.dispatchEvent(new CustomEvent('smartchat:open-chat', { detail: intent }))

  if (listeners.length === 0) {
    pending = intent
    return
  }
  listeners.slice().forEach((l) => l(intent))
}

export function subscribeNavigation(listener: Listener): () => void {
  listeners.push(listener)
  if (pending) {
    const replay = pending
    pending = null
    listener(replay)
  }
  return () => {
    listeners = listeners.filter((l) => l !== listener)
  }
}

/** Test helper — reset module state between specs. */
export function __resetNavigationBus(): void {
  listeners = []
  pending = null
  lastKey = ''
  lastAt = 0
}
