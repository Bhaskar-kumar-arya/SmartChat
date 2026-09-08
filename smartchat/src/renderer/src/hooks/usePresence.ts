// Presence is now owned by a single context provider (F12-05 / F3-11) so that
// `ChatLayout` and `ChatList` share one `onPresenceUpdate` subscription and one
// expiry interval instead of instantiating their own. This module is kept as a
// re-export so existing import paths keep working.
export { usePresence, PresenceProvider, PresenceContext } from '../context/PresenceContext'
export type { PresenceContextValue } from '../context/PresenceContext'
