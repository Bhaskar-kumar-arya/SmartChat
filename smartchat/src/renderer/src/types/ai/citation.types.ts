/**
 * Polymorphic discriminated union for all citation target types.
 * Adding a new entity type is purely additive — no other file changes required
 * to satisfy OCP.
 */
export type CitationEntity =
  | { type: 'message'; chatJid: string; messageId: string }
  | { type: 'chat';    chatJid: string }
  | { type: 'file';    filePath: string };

/** Icon mapping — one entry per discriminant. Also additive. */
export const CITATION_ICONS: Record<CitationEntity['type'], string> = {
  message: '💬',
  chat:    '👥',
  file:    '📄',
};
