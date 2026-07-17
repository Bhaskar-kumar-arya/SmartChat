export type CitationEntity =
  | { type: 'message'; chatJid: string; messageId: string }
  | { type: 'chat'; chatJid: string }
  | { type: 'file'; filePath: string };

export interface ICitationEmitter {
  /** Register an entity and receive its sequential citation index */
  register(entity: CitationEntity): number;
  /** Return all registered citations as a structured map */
  getEntries(): ReadonlyMap<number, CitationEntity>;
}
