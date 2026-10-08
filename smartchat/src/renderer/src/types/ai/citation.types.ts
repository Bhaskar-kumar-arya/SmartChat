import type { CitationEntity } from '../../../../shared/ipc/dto'

export type { CitationEntity }

/** Icon mapping — one entry per discriminant. Also additive. */
export const CITATION_ICONS: Record<CitationEntity['type'], string> = {
  message: '💬',
  chat:    '👥',
  file:    '📄',
};
