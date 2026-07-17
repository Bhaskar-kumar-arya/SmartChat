import { CitationEntity, ICitationEmitter } from './ICitationEmitter';

export interface ICitationSessionManager {
  /** Create a new emitter starting at the correct offset for this session */
  createEmitter(sessionId: string): Promise<ICitationEmitter>;
  
  /** Persist all emitted citations from a tool execution turn */
  persist(sessionId: string, citations: ReadonlyMap<number, CitationEntity>): Promise<void>;
  
  /** Retrieve a single citation for frontend rendering */
  resolve(sessionId: string, index: number): Promise<CitationEntity | null>;
  
  /** Retrieve all citations for a session (for full-page render) */
  resolveAll(sessionId: string): Promise<ReadonlyMap<number, CitationEntity>>;
}
