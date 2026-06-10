/**
 * Named constants to replace magic numbers throughout the codebase.
 * Import from here instead of using bare numeric literals.
 */

// ── Protocol message types ─────────────────────────────────────────────────
export const PROTOCOL_TYPE_REVOKE = 0
export const PROTOCOL_TYPE_EDIT = 14

// ── History sync types ────────────────────────────────────────────────────
export const SYNC_TYPE_INITIAL = 0
export const SYNC_TYPE_FULL = 2
export const SYNC_TYPE_RECENT = 3
export const SYNC_TYPE_GROUP_HYDRATION = 6

// ── Progress thresholds ───────────────────────────────────────────────────
/** Progress percentage at which we consider sync "done" and trigger finishSync. */
export const SYNC_AUTO_FINISH_THRESHOLD = 95

// ── Timeouts ──────────────────────────────────────────────────────────────
/** Maximum ms to wait for history sync chunks before declaring sync complete. */
export const HISTORY_SYNC_TIMEOUT_MS = 180_000
/** Reconnect delay after a restart-required disconnect. */
export const RECONNECT_DELAY_RESTART_MS = 500
/** Reconnect delay for all other transient disconnects. */
export const RECONNECT_DELAY_DEFAULT_MS = 3_000

// ── Media MIME type map (extension → MIME) ────────────────────────────────
export const MEDIA_MIME_MAP: Record<string, string> = {
  pdf: 'application/pdf',
  doc: 'application/msword',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xls: 'application/vnd.ms-excel',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  ppt: 'application/vnd.ms-powerpoint',
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  txt: 'text/plain',
  zip: 'application/zip',
  rar: 'application/x-rar-compressed'
}

// ── Message type display labels ───────────────────────────────────────────
export const MESSAGE_TYPE_LABELS: Record<string, string> = {
  stickerMessage: 'Sticker',
  lottieStickerMessage: 'Sticker',
  imageMessage: 'Photo',
  videoMessage: 'Video',
  ptvMessage: 'Video note',
  documentMessage: 'Document',
  audioMessage: 'Audio',
  contactMessage: 'Contact',
  locationMessage: 'Location',
  liveLocationMessage: 'Live Location',
  pollCreationMessage: 'Poll',
  pollUpdateMessage: 'Poll Update',
  reactionMessage: 'Reaction'
}
